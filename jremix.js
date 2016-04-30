var theChorus;

function createJRemixer(context, jquery) {
    var $ = jquery;
    var tuna;

    var remixer = {

        remixTrackById: function(id, callback) {
            var url = 'http://labs.echonest.com/Uploader/profile?callback=?'
            $.getJSON(url, { trid:trid}, function(data) {
                if (data.response.status.code == 0) {
                    remixer.remixTrack(data.response.track, callback)
                }
            });
        },

        remixTrack : function(track, callback) {

            function fetchAudio(url) {
                var request = new XMLHttpRequest();
                trace("fetchAudio " + url);
                track.buffer = null;
                request.open("GET", url, true);
                request.responseType = "arraybuffer";
                this.request = request;

                request.onload = function() {
                    trace('audio loaded');
                     if (false) {
                        track.buffer = context.createBuffer(request.response, false);
                        track.status = 'ok'
                        callback(1, track, 100);
                    } else {
                        context.decodeAudioData(request.response, 
                            function(buffer) {      // completed function
                                track.buffer = buffer;
                                track.status = 'ok'
                                callback(1, track, 100);
                            }, 
                            function(e) { // error function
                                track.status = 'error: loading audio'
                                callback(-1, track, 0);
                                console.log('audio error', e);
                            }
                        );
                    }
                }

                request.onerror = function(e) {
                    trace('error loading loaded');
                    track.status = 'error: loading audio'
                    callback(-1, track, 0);
                }

                request.onprogress = function(e) {
                    var percent = Math.round(e.position * 100  / e.totalSize);
                    if (isNaN(percent)) {
                        percent = 0;
                    }
                    callback(0, track, percent);
                }
                request.send();
            }

            function preprocessTrack(track) {
                trace('preprocessTrack');
                var types = ['sections', 'bars', 'beats', 'tatums', 'segments'];

                
                for (var i in types) {
                    var type = types[i];
                    trace('preprocessTrack ' + type);
                    for (var j in track.analysis[type]) {
                        var qlist = track.analysis[type]

                        j = parseInt(j)

                        var q = qlist[j]
                        q.track = track;
                        q.which = j;
                        if (j > 0) {
                            q.prev = qlist[j-1];
                        } else {
                            q.prev = null
                        }
                        
                        if (j < qlist.length - 1) {
                            q.next = qlist[j+1];
                        } else {
                            q.next = null
                        }
                    }
                }

                connectQuanta(track, 'sections', 'bars');
                connectQuanta(track, 'bars', 'beats');
                connectQuanta(track, 'beats', 'tatums');
                connectQuanta(track, 'tatums', 'segments');

                connectFirstOverlappingSegment(track, 'bars');
                connectFirstOverlappingSegment(track, 'beats');
                connectFirstOverlappingSegment(track, 'tatums');

                connectAllOverlappingSegments(track, 'bars');
                connectAllOverlappingSegments(track, 'beats');
                connectAllOverlappingSegments(track, 'tatums');


                filterSegments(track);
            }

            function filterSegments(track) {
                var threshold = .3;
                var fsegs = [];
                fsegs.push(track.analysis.segments[0]);
                for (var i = 1; i < track.analysis.segments.length; i++) {
                    var seg = track.analysis.segments[i];
                    var last = fsegs[fsegs.length - 1];
                    if (isSimilar(seg, last) && seg.confidence < threshold) {
                        fsegs[fsegs.length -1].duration += seg.duration;
                    } else {
                        fsegs.push(seg);
                    }
                }
                track.analysis.fsegments = fsegs;
            }

            function isSimilar(seg1, seg2) {
                var threshold = 1;
                var distance = timbral_distance(seg1, seg2);
                return (distance < threshold);
            }

            function connectQuanta(track, parent, child) {
                var last = 0;
                var qparents = track.analysis[parent];
                var qchildren = track.analysis[child];

                for (var i in qparents) {
                    var qparent = qparents[i]
                    qparent.children = [];

                    for (var j = last; j < qchildren.length; j++) {
                        var qchild = qchildren[j];
                        if (qchild.start >= qparent.start 
                                    && qchild.start < qparent.start + qparent.duration) {
                            qchild.parent = qparent;
                            qchild.indexInParent = qparent.children.length;
                            qparent.children.push(qchild);
                            last = j;
                        } else if (qchild.start > qparent.start) {
                            break;
                        }
                    }
                }
            }

            // connects a quanta with the first overlapping segment
            function connectFirstOverlappingSegment(track, quanta_name) {
                var last = 0;
                var quanta = track.analysis[quanta_name];
                var segs = track.analysis.segments;

                for (var i = 0; i < quanta.length; i++) {
                    var q = quanta[i]

                    for (var j = last; j < segs.length; j++) {
                        var qseg = segs[j];
                        if (qseg.start >= q.start) {
                            q.oseg = qseg;
                            last = j;
                            break
                        } 
                    }
                }
            }

            function connectAllOverlappingSegments(track, quanta_name) {
                var last = 0;
                var quanta = track.analysis[quanta_name];
                var segs = track.analysis.segments;

                for (var i = 0; i < quanta.length; i++) {
                    var q = quanta[i]
                    q.overlappingSegments = [];

                    for (var j = last; j < segs.length; j++) {
                        var qseg = segs[j];
                        // seg starts before quantum so no
                        if ((qseg.start + qseg.duration) < q.start) {
                            continue;
                        }
                        // seg starts after quantum so no
                        if (qseg.start > (q.start + q.duration)) {
                            break;
                        }
                        last = j;
                        q.overlappingSegments.push(qseg);
                    }
                }
            }


            if (track.status == 'complete') {
                preprocessTrack(track);
                fetchAudio(track.info.url);
            } else {
                track.status = 'error: incomplete analysis';
                callback(false, track);
            }
        },

        getPlayer : function() {
            var queueTime = 0;
            var audioGain;
            if ('createGain' in context) {
                audioGain = context.createGain();
            } else {
                audioGain = context.createGain();
            }
            var curAudioSource = null;
            var curQ = null;
            var speedFactor = 1.0;
            var playbackRate = 1.0;
            var changed = true
            audioGain.gain.value = 1;
            //audioGain.connect(context.destination);

            tuna = new Tuna(context);

            var chorus = new tuna.Chorus({
                 rate: 3.5,         //0.01 to 8+
                 feedback: 0.9,     //0 to 1+
                 delay: 0.0545,     //0 to 1
                 bypass: 1          
             });


            var delayFilter = new tuna.Delay({
                feedback: 0.60,    //0 to 1+
                delayTime: 150,    //how many milliseconds should the wet signal be delayed? 
                wetLevel: 0.60,    //0 to 1+
                dryLevel: 1.0,       //0 to 1+
                cutoff: 20000,        //cutoff frequency of the built in highpass-filter. 20 to 22050
                bypass: 1
            });


            var phaser = new tuna.Phaser({
                 rate: 6.2,                     //0.01 to 8 is a decent range, but higher values are possible
                 depth: 0.3,                    //0 to 1
                 feedback: 0.8,                 //0 to 1+
                 stereoPhase: 30,               //0 to 180
                 baseModulationFrequency: 700,  //500 to 1500
                 bypass: 1
             });

            var overdrive = new tuna.Overdrive({
                    outputGain: 0.3,         //0 to 1+
                    drive: 0.7,              //0 to 1
                    curveAmount: .4,          //0 to 1
                    algorithmIndex: 2,       //0 to 5, selects one of our drive algorithms
                    bypass: 1
                });

            var compressor = new tuna.Compressor({
                     threshold: 0.5,    //-100 to 0
                     makeupGain: 1,     //0 and up
                     attack: 1,         //0 to 1000
                     release: 0,        //0 to 3000
                     ratio: 4,          //1 to 20
                     knee: 5,           //0 to 40
                     automakeup: true,  //true/false
                     bypass: 1
                 });

            var tremolo = new tuna.Tremolo({
                  intensity: 0.3,    //0 to 1
                  rate: 0.1,         //0.001 to 8
                  stereoPhase: 0,    //0 to 180
                  bypass: 1
              });

            var wahwah = new tuna.WahWah({
                 automode: true,                //true/false
                 baseFrequency: 0.1,            //0 to 1
                 excursionOctaves: 2,           //1 to 6
                 sweep: 0.2,                    //0 to 1
                 resonance: 50,                 //1 to 100
                 sensitivity: 0.5,              //-1 to 1
                 bypass: 1
             });

            var compressor = new tuna.MoogFilter({
                cutoff: 0.065,    //0 to 1
                resonance: 3.5,   //0 to 4
                bufferSize: 4096,  //256 to 16384
                bypass: 1
            });

            var compressor = new tuna.Bitcrusher({
                bits: 4,          //1 to 16
                normfreq: 0.1,    //0 to 1
                bufferSize: 4096,  //256 to 16384
                bypass: 1
            });

            audioGain.connect(chorus.input);
            chorus.connect(delayFilter.input);
            delayFilter.connect(overdrive.input);
            overdrive.connect(phaser.input);
            phaser.connect(compressor.input);
            compressor.connect(tremolo.input);
            tremolo.connect(wahwah.input);
            wahwah.connect(context.destination);

            function queuePlay(when, q) {
                audioGain.gain.value = 1;
                if (isAudioBuffer(q)) {
                    var audioSource = context.createBufferSource();
                    audioSource.buffer = q;
                    audioSource.connect(audioGain);
                    audioSource.start(when);
                    return when;
                } else if ($.isArray(q)) {
                    for (var i in q) {
                        when = queuePlay(when, q[i]);
                    }
                    return when;
                } else if (isQuantum(q)) {
                    var audioSource = context.createBufferSource();
                    //var duration = q.duration * .7;
                    var duration = q.duration;
                    audioSource.buffer = q.track.buffer;
                    audioSource.connect(audioGain);
                    audioSource.start(when, q.start, duration);
                    q.audioSource = audioSource;
                    return when + duration;
                } else {
                    error("can't play " + q);
                    return when;
                }
            }

            // this is the one that is actually used
            function playQuantum(when, q) {
                var now = context.currentTime;
                var start = when == 0 ? now : when;
                var duration = q.duration * speedFactor / playbackRate;
                var next = start + duration;

                if (!changed && speedFactor == 1 && curQ && curQ.track === q.track && curQ.which + 1 == q.which) {
                    // let it ride
                } else {
                    var audioSource = context.createBufferSource();
                    audioGain.gain.value = 1;
                    audioSource.buffer = q.track.buffer;
                    audioSource.connect(audioGain);
                    audioSource.playbackRate.value = playbackRate;
                    var tduration = track.audio_summary.duration - q.start;
                    audioSource.start(start, q.start, tduration);
                    if (curAudioSource) {
                        curAudioSource.stop(start);
                    }
                    curAudioSource = audioSource;
                }
                q.audioSource = curAudioSource;
                curQ = q;
                changed = false;
                return duration;
            }

            function playQuantum2(q) {
                var audioSource = context.createBufferSource();
                audioGain.gain.value = 1;
                audioSource.buffer = q.track.buffer;
                audioSource.connect(audioGain);
                audioSource.start(0, q.start, q.duration);
                if (curAudioSource) {
                    curAudioSource.stop(0);
                }
                curAudioSource = audioSource;
                q.audioSource = curAudioSource;
                curQ = q;
                return q.duration;
            }

            function error(s) {
                console.log(s);
            }

            var player = {
                play: function(when, q) {
                    return playQuantum(when, q);
                    //queuePlay(0, q);
                },

                playNow: function(q) {
                    playQuantum2(q);
                },

                addCallback: function(callback) {
                },

                queue: function(q) {
                    var now = context.currentTime;
                    if (now > queueTime) {
                        queueTime = now;
                    } 
                    queueTime = queuePlay(queueTime, q);
                },

                queueRest: function(duration) {
                    queueTime += duration;
                },

                setSpeedFactor : function(factor) {
                    speedFactor = factor;
                },

                getSpeedFactor: function() {
                    return speedFactor;
                },

                setPlaybackRate : function(theRate) {
                    changed = true;
                    playbackRate = theRate;
                },

                getPlaybackRate: function() {
                    return playbackRate;
                },

                insertNode: function(node) {
                    audioGain.disconnect();
                    node.connect(context.destination);
                    audioGain.connect(node.input);
                },

                stop: function(q) {
                    if (q === undefined) {
                        if (curAudioSource) {
                            curAudioSource.stop(0);
                            curAudioSource = null;
                        }
                        //audioGain.gain.value = 0;
                        //audioGain.disconnect();
                    } else {
                        if ('audioSource' in q) {
                            if (q.audioSource != null) {
                                q.audioSource.stop(0);
                            }
                        }
                    }
                    curQ = null;
                },

                curTime: function() {
                    return context.currentTime;
                },

                filters: {
                    chorus:chorus,
                    delay:delayFilter,
                    overdrive:overdrive,
                    phaser:phaser,
                    compressor:compressor,
                    tremolo:tremolo,
                    wahwah:wahwah
                }
            }
            return player;
        },

        fetchSound : function(audioURL, callback) {
            var request = new XMLHttpRequest();

            trace("fetchSound " + audioURL);
            request.open("GET", audioURL, true);
            request.responseType = "arraybuffer";
            this.request = request;

            request.onload = function() {
                var buffer = context.createBuffer(request.response, false);
                callback(true, buffer);
            }

            request.onerror = function(e) {
                callback(false, null);
            }
            request.send();
        },
    };

    function isQuantum(a) {
        return 'start' in a && 'duration' in a;
    }

    function isAudioBuffer(a) {
        return 'getChannelData' in a;
    }

    function trace(text) {
        if (false) {
            console.log(text);
        }
    }

    return remixer;
}


function euclidean_distance(v1, v2) {
    var sum = 0;
    for (var i = 0; i < 3; i++) {
        var delta = v2[i] - v1[i];
        sum += delta * delta;
    }
    return Math.sqrt(sum);
}

function timbral_distance(s1, s2) {
    return euclidean_distance(s1.timbre, s2.timbre);
}


function clusterSegments(track, numClusters, fieldName, vecName) {
    var vname = vecName || 'timbre';
    var fname = fieldName || 'cluster';
    var maxLoops = 1000;

    function zeroArray(size) {
        var arry = [];
        for (var i = 0; i < size; i++) {
            arry.push(0);
        }
        return arry;
    }

    function reportClusteringStats() {
        var counts = zeroArray(numClusters);
        for (var i = 0; i < track.analysis.segments.length; i++) {
            var cluster = track.analysis.segments[i][fname];
            counts[cluster]++;
        }
        //console.log('clustering stats');
        for (var i = 0; i < counts.length; i++) {
            //console.log('clus', i, counts[i]);
        }
    }

    function sumArray(v1, v2) {
        for (var i = 0; i < v1.length; i++) {
            v1[i] += v2[i];
        }
        return v1;
    }

    function divArray(v1, scalar) {
        for (var i = 0; i < v1.length; i++) {
            v1[i] /= scalar
        }
        return v1;
    }
    function getCentroid(cluster) {
        var count = 0;
        var segs = track.analysis.segments;
        var vsum = zeroArray(segs[0][vname].length);

        for (var i = 0; i < segs.length; i++) {
            if (segs[i][fname] === cluster) {
                count++;
                vsum = sumArray(vsum, segs[i][vname]);
            }
        }

        vsum = divArray(vsum, count);
        return vsum;
    }

    function findNearestCluster(clusters, seg) {
        var shortestDistance = Number.MAX_VALUE;
        var bestCluster = -1;

        for (var i = 0; i < clusters.length; i++) {
            var distance = euclidean_distance(clusters[i], seg[vname]);
            if (distance < shortestDistance) {
                shortestDistance = distance;
                bestCluster = i;
            }
        }
        return bestCluster;
    }

    // kmeans clusterer
    // use random initial assignments
    for (var i = 0; i < track.analysis.segments.length; i++) {
        track.analysis.segments[i][fname] = Math.floor(Math.random() * numClusters);
    }

    reportClusteringStats();

    while (maxLoops-- > 0) {
        // calculate cluster centroids
        var centroids = [];
        for (var i = 0; i < numClusters; i++) {
            centroids[i] = getCentroid(i);
        }
        // reassign segs to clusters
        var switches = 0;
        for (var i = 0; i < track.analysis.segments.length; i++) {
            var seg = track.analysis.segments[i];
            var oldCluster = seg[fname];
            var newCluster = findNearestCluster(centroids, seg);
            if (oldCluster !== newCluster) {
                switches++;
                seg[fname] = newCluster;
            }
        }
        //console.log("loopleft", maxLoops, 'switches', switches);
        if (switches == 0) {
            break;
        }
    }
    reportClusteringStats();
}
