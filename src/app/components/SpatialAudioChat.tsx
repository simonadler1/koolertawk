"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import PartySocket from "partysocket";

interface Position {
  x: number;
  y: number;
}

interface Seat {
  id: string;
  position: Position;
  occupied: boolean;
  userId?: string;
}

interface User {
  id: string;
  name: string;
  position: Position;
  seatId?: string;
  audioEnabled: boolean;
}

interface RoomState {
  seats: Seat[];
  users: User[];
}

interface AudioConnection {
  userId: string;
  peerConnection: RTCPeerConnection;
  audioElement: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
  gainNode?: GainNode;
  pannerNode?: PannerNode;
  usingWebAudio: boolean;
  connectionType: 'spatial' | 'basic' | 'direct';
}

export default function SpatialAudioChat() {
  const [socket, setSocket] = useState<PartySocket | null>(null);
  const [roomState, setRoomState] = useState<RoomState>({ seats: [], users: [] });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userName, setUserName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState<
    Array<{ userId: string; userName: string; message: string; position: Position }>
  >([]);
  const [chatInput, setChatInput] = useState("");

  // Audio testing states
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const [showAudioTest, setShowAudioTest] = useState(false);

  // Live mic indicator states
  const [liveMicLevel, setLiveMicLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioConnectionsRef = useRef<Map<string, AudioConnection>>(new Map());
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  // Live mic monitoring refs
  const liveMicAnalyserRef = useRef<AnalyserNode | null>(null);
  const liveMicAnimationFrameRef = useRef<number | null>(null);

  // Refs to prevent stale closures in WebSocket handlers
  const currentUserRef = useRef<User | null>(null);
  const isJoinedRef = useRef<boolean>(false);
  const audioEnabledRef = useRef<boolean>(true);

  // Stable reference for spatial settings function
  const applySpatialSettingsRef = useRef<(() => void) | null>(null);

  // Cleanup function for audio connections
  const cleanupAudioConnection = useCallback((userId: string, reason: string) => {
    const connection = audioConnectionsRef.current.get(userId);
    if (!connection) {
      console.log(`⚠️ No connection to cleanup for ${userId}`);
      return;
    }

    console.log(`🧹 Cleaning up audio connection for ${userId}: ${reason}`);

    try {
      // Pause and reset audio element
      connection.audioElement.pause();
      connection.audioElement.srcObject = null;
      console.log(`✅ Audio element cleaned for ${userId}`);
    } catch (error) {
      console.error(`❌ Error cleaning audio element for ${userId}:`, error);
    }

    try {
      // Disconnect Web Audio nodes
      if (connection.source) {
        connection.source.disconnect();
        console.log(`✅ MediaElementSource disconnected for ${userId}`);
      }
      if (connection.pannerNode) {
        connection.pannerNode.disconnect();
        console.log(`✅ PannerNode disconnected for ${userId}`);
      }
      if (connection.gainNode) {
        connection.gainNode.disconnect();
        console.log(`✅ GainNode disconnected for ${userId}`);
      }
    } catch (error) {
      console.error(`❌ Error disconnecting Web Audio nodes for ${userId}:`, error);
    }

    try {
      // Close peer connection
      connection.peerConnection.close();
      console.log(`✅ PeerConnection closed for ${userId}`);
    } catch (error) {
      console.error(`❌ Error closing peer connection for ${userId}:`, error);
    }

    // Remove from map
    audioConnectionsRef.current.delete(userId);
    console.log(`✅ Connection removed from map for ${userId}`);
  }, []);

  // Keep refs in sync with state
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    isJoinedRef.current = isJoined;
  }, [isJoined]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);


  const initializeAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log("Audio context created (basic mode - no spatial listener config)");
    }

    if (audioContextRef.current.state === "suspended") {
      console.log("Resuming suspended audio context");
      try {
        await audioContextRef.current.resume();
        console.log("Audio context resumed successfully");
      } catch (error) {
        console.error("Failed to resume audio context:", error);
        throw error;
      }
    }

    console.log(`Audio context state: ${audioContextRef.current.state}`);
  }, []);

  // Audio testing functions
  const startMicTest = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setTestStream(stream);

      await initializeAudioContext();
      const source = audioContextRef.current!.createMediaStreamSource(stream);
      const analyser = audioContextRef.current!.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start monitoring mic level
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (analyserRef.current && testStream) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setMicLevel(Math.round((average / 255) * 100));
          requestAnimationFrame(updateLevel);
        }
      };
      updateLevel();

      console.log("Microphone test started");
    } catch (error) {
      console.error("Error starting microphone test:", error);
      alert("Could not access microphone. Please check permissions.");
    }
  }, [initializeAudioContext, testStream]);

  const stopMicTest = useCallback(() => {
    if (testStream) {
      testStream.getTracks().forEach((track) => track.stop());
      setTestStream(null);
      setMicLevel(0);
      analyserRef.current = null;
      console.log("Microphone test stopped");
    }
  }, [testStream]);

  const startRecording = useCallback(() => {
    if (!testStream) return;

    const mediaRecorder = new MediaRecorder(testStream);
    const chunks: BlobPart[] = [];

    mediaRecorder.ondataavailable = (event) => {
      chunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/wav" });
      setRecordedBlob(blob);
      console.log("Recording saved");
    };

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setIsRecording(true);

    // Stop after 5 seconds
    setTimeout(() => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
      }
    }, 5000);

    console.log("Started 5-second recording");
  }, [testStream, isRecording]);

  const playRecording = useCallback(() => {
    if (!recordedBlob) return;

    const url = URL.createObjectURL(recordedBlob);
    const audio = new Audio(url);

    audio.onended = () => {
      setIsPlayingTest(false);
      URL.revokeObjectURL(url);
    };

    audio.onerror = (e) => {
      console.error("Error playing recording:", e);
      setIsPlayingTest(false);
      URL.revokeObjectURL(url);
    };

    setIsPlayingTest(true);
    audio.play();
    testAudioRef.current = audio;
    console.log("Playing back recording");
  }, [recordedBlob]);

  const playSpeakerTest = useCallback(
    async (frequency: number = 440, volume: number = 0.3) => {
      try {
        await initializeAudioContext();

        const oscillator = audioContextRef.current!.createOscillator();
        const gainNode = audioContextRef.current!.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContextRef.current!.destination);

        oscillator.frequency.setValueAtTime(frequency, audioContextRef.current!.currentTime);
        gainNode.gain.setValueAtTime(volume, audioContextRef.current!.currentTime);

        oscillator.start();

        // Play for 1 second
        setTimeout(() => {
          oscillator.stop();
        }, 1000);

        console.log(`Playing ${frequency}Hz tone at ${Math.round(volume * 100)}% volume`);
      } catch (error) {
        console.error("Error playing speaker test:", error);
      }
    },
    [initializeAudioContext]
  );

  // Live mic level monitoring
  const startLiveMicMonitoring = useCallback(
    async (stream: MediaStream) => {
      if (!audioContextRef.current || !stream.active) return;

      try {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        liveMicAnalyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateLiveLevel = () => {
          if (liveMicAnalyserRef.current && stream.active && isJoined && audioEnabled) {
            liveMicAnalyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const smoothedLevel = Math.round((average / 255) * 100);
            setLiveMicLevel(smoothedLevel);
            liveMicAnimationFrameRef.current = requestAnimationFrame(updateLiveLevel);
          } else {
            setLiveMicLevel(0);
          }
        };

        updateLiveLevel();
        console.log("Started live microphone monitoring");
      } catch (error) {
        console.error("Error starting live mic monitoring:", error);
      }
    },
    [isJoined, audioEnabled]
  );

  const stopLiveMicMonitoring = useCallback(() => {
    if (liveMicAnimationFrameRef.current) {
      cancelAnimationFrame(liveMicAnimationFrameRef.current);
      liveMicAnimationFrameRef.current = null;
    }
    liveMicAnalyserRef.current = null;
    setLiveMicLevel(0);
    console.log("Stopped live microphone monitoring");
  }, []);

  // Start live mic monitoring when localStream becomes available
  useEffect(() => {
    if (localStream && audioContextRef.current && isJoined && audioEnabled) {
      startLiveMicMonitoring(localStream);
    } else {
      stopLiveMicMonitoring();
    }

    return () => {
      stopLiveMicMonitoring();
    };
  }, [localStream, isJoined, audioEnabled, startLiveMicMonitoring, stopLiveMicMonitoring]);

  const calculateSpatialGain = useCallback((userPos: Position, otherPos: Position): number => {
    const distance = Math.sqrt(Math.pow(otherPos.x - userPos.x, 2) + Math.pow(otherPos.y - userPos.y, 2));
    const maxDistance = 80; // percentage units - much larger range

    if (distance >= maxDistance) return 0;

    // Multiple volume zones for better spatial experience
    if (distance <= 15) {
      // Very close - full volume
      return 1.0;
    } else if (distance <= 30) {
      // Close - high volume (80-100%)
      return 0.8 + 0.2 * (1 - (distance - 15) / 15);
    } else if (distance <= 50) {
      // Medium distance - medium volume (40-80%)
      return 0.4 + 0.4 * (1 - (distance - 30) / 20);
    } else {
      // Far but audible - low volume (0-40%)
      return 0.4 * (1 - (distance - 50) / 30);
    }
  }, []);

  // Simple spatial audio update - just distance-based gain for now
  // TODO: Re-add positional audio after basic playback is stable


  // Enhanced spatial audio update - supports both basic gain and full spatial positioning
  const updateSpatialAudio = useCallback(() => {
    const currentCurrentUser = currentUserRef.current;
    if (!currentCurrentUser || !audioContextRef.current) {
      console.log("⚠️ Cannot update spatial audio: missing currentUser or audioContext");
      return;
    }

    console.log(`🔊 Updating spatial audio for ${audioConnectionsRef.current.size} connections`);
    console.log(`👤 Current user position: x=${currentCurrentUser.position.x}, y=${currentCurrentUser.position.y}`);

    const currentTime = audioContextRef.current.currentTime;

    audioConnectionsRef.current.forEach((connection, userId) => {
      const otherUser = roomState.users.find((u) => u.id === userId);
      if (otherUser && connection.gainNode) {
        // Calculate distance-based gain
        const gain = calculateSpatialGain(currentCurrentUser.position, otherUser.position);
        const distance = Math.sqrt(
          Math.pow(otherUser.position.x - currentCurrentUser.position.x, 2) +
          Math.pow(otherUser.position.y - currentCurrentUser.position.y, 2)
        );

        // Handle different connection types
        if (connection.connectionType === 'spatial' && connection.pannerNode) {
          // Full spatial audio with 3D positioning
          try {
            // Convert room coordinates to 3D meters
            const x = (otherUser.position.x - 50) * 0.2; // -10 to +10 meters
            const z = (otherUser.position.y - 50) * 0.2; // -10 to +10 meters
            const y = 0; // Keep on ground plane

            // Position the panner
            if (connection.pannerNode.positionX) {
              connection.pannerNode.positionX.setValueAtTime(x, currentTime);
              connection.pannerNode.positionY.setValueAtTime(y, currentTime);
              connection.pannerNode.positionZ.setValueAtTime(z, currentTime);
            } else if (connection.pannerNode.setPosition) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (connection.pannerNode as any).setPosition(x, y, z);
            }

            // Apply distance-based gain
            connection.gainNode.gain.setValueAtTime(gain, currentTime);
            const actualGain = connection.gainNode.gain.value;

            console.log(`🎧 User ${otherUser.name}: roomPos=(${otherUser.position.x},${otherUser.position.y}) 3DPos=(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}) distance=${Math.round(distance)}% gain=${actualGain.toFixed(3)} (spatial)`);
          } catch (pannerError) {
            console.error(`❌ Failed to position panner for ${otherUser.name}:`, pannerError);
          }

        } else if (connection.connectionType === 'basic' && connection.usingWebAudio) {
          // Basic Web Audio with distance-based gain only
          connection.gainNode.gain.setValueAtTime(gain, currentTime);
          const actualGain = connection.gainNode.gain.value;
          console.log(`🎯 User ${otherUser.name}: pos=(${otherUser.position.x},${otherUser.position.y}) distance=${Math.round(distance)}% gain=${actualGain.toFixed(3)} (basic Web Audio)`);

        } else {
          // Direct HTMLAudioElement playback - no gain control
          console.log(`🎯 User ${otherUser.name}: pos=(${otherUser.position.x},${otherUser.position.y}) distance=${Math.round(distance)}% (direct playback, no spatial control)`);
        }
      } else {
        console.log(`⚠️ Missing data for user ${userId}: otherUser=${!!otherUser}, gainNode=${!!connection.gainNode}`);
      }
    });

    console.log(`✅ Spatial audio update completed at ${currentTime.toFixed(3)}s`);
  }, [roomState.users, calculateSpatialGain]);

  // Create and store stable spatial settings function for backward compatibility
  useEffect(() => {
    applySpatialSettingsRef.current = updateSpatialAudio;
  }, [updateSpatialAudio]);

  // Stable applySpatialSettings function for backward compatibility
  const applySpatialSettings = useCallback(() => {
    applySpatialSettingsRef.current?.();
  }, []);

  const createPeerConnection = useCallback(
    async (userId: string, streamToUse?: MediaStream): Promise<RTCPeerConnection> => {
      console.log(`Creating peer connection for user ${userId}`);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Store the peer connection immediately to ensure signaling can find it
      audioConnectionsRef.current.set(userId, {
        userId,
        peerConnection: pc,
        audioElement: new Audio(), // Placeholder, will be replaced in ontrack
        gainNode: undefined,
      });

      // Add connection state monitoring with proper cleanup
      pc.onconnectionstatechange = () => {
        console.log(`WebRTC connection with ${userId}: ${pc.connectionState}`);
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          console.warn(`Audio connection lost with user ${userId}`);
          cleanupAudioConnection(userId, `connection ${pc.connectionState}`);
        } else if (pc.connectionState === "closed") {
          console.log(`Connection properly closed for ${userId}`);
          cleanupAudioConnection(userId, "connection closed");
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection with ${userId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") {
          console.error(`ICE connection failed with user ${userId}`);
        }
      };

      // Ensure AudioContext is ready before adding tracks
      try {
        await initializeAudioContext();
      } catch (error) {
        console.error("Failed to initialize audio context:", error);
        throw new Error("Audio context initialization failed");
      }

      // Use the provided stream or fall back to the current localStream
      const currentLocalStream = streamToUse || localStream;
      if (currentLocalStream && currentLocalStream.active) {
        const tracks = currentLocalStream.getTracks();
        console.log(`📤 Local stream details for ${userId}:`, {
          active: currentLocalStream.active,
          trackCount: tracks.length,
          tracks: tracks.map(t => ({
            kind: t.kind,
            enabled: t.enabled,
            readyState: t.readyState,
            muted: t.muted
          }))
        });

        if (tracks.length === 0) {
          console.warn("⚠️ Local stream has no tracks");
        } else {
          tracks.forEach((track) => {
            if (track.readyState === "live") {
              console.log(`✅ Adding local ${track.kind} track to peer connection with ${userId}`);
              pc.addTrack(track, currentLocalStream);
            } else {
              console.warn(`⚠️ Track ${track.kind} is not live (${track.readyState})`);
            }
          });
        }
      } else {
        console.warn(`⚠️ No active local stream available when creating connection for ${userId}`, {
          localStream: !!currentLocalStream,
          active: currentLocalStream?.active
        });
      }

      pc.ontrack = async (event) => {
        console.log(`🎵 Received remote audio track from ${userId}`);
        console.log(`Stream details:`, {
          streamId: event.streams[0]?.id,
          tracks: event.streams[0]?.getTracks().map(t => ({
            kind: t.kind,
            enabled: t.enabled,
            readyState: t.readyState,
            muted: t.muted
          }))
        });

        // Clean up any existing connection first (Chrome restriction: one MediaElementSource per stream)
        const existingConnection = audioConnectionsRef.current.get(userId);
        if (existingConnection) {
          cleanupAudioConnection(userId, "renegotiation");
        }

        try {
          // Ensure AudioContext is ready
          if (audioContextRef.current?.state === "suspended") {
            console.log(`Resuming suspended audio context for ${userId}`);
            await audioContextRef.current.resume();
          }

          // Step 1: Create brand new HTMLAudioElement for this stream
          console.log(`🔧 Creating fresh audio element for ${userId}`);
          const audioElement = new Audio();
          audioElement.srcObject = event.streams[0];
          audioElement.autoplay = true;
          audioElement.muted = false; // Keep unmuted initially for fallback
          audioElement.volume = 1.0;

          // Enhanced error handling
          audioElement.onerror = (e) => {
            console.error(`❌ Audio element error for user ${userId}:`, e);
          };

          audioElement.onplay = () => {
            console.log(`▶️ Audio element started playing for ${userId}`);
          };

          // Step 2: Ensure element starts playing
          console.log(`🎬 Starting audio playback for ${userId}`);
          await audioElement.play();
          console.log(`✅ Audio element playing for ${userId}`);

          // Step 3: Attempt to build Web Audio graph
          let source: MediaElementAudioSourceNode | undefined;
          let gainNode: GainNode | undefined;
          let pannerNode: PannerNode | undefined;
          let connectionType: 'spatial' | 'basic' | 'direct' = 'direct';
          let graphSuccessful = false;

          try {
            console.log(`🔧 Building Web Audio graph for ${userId}`);

            // Create MediaElementSource immediately after element plays
            source = audioContextRef.current!.createMediaElementSource(audioElement);
            console.log(`✅ MediaElementSource created for ${userId}`);

            // Try spatial audio first
            try {
              pannerNode = audioContextRef.current!.createPanner();
              gainNode = audioContextRef.current!.createGain();

              // Configure PannerNode for spatial audio
              pannerNode.panningModel = 'HRTF';
              pannerNode.distanceModel = 'inverse';
              pannerNode.refDistance = 1;
              pannerNode.maxDistance = 20;
              pannerNode.rolloffFactor = 1;

              // Connect: MediaElementSource -> PannerNode -> GainNode -> Destination
              source.connect(pannerNode);
              pannerNode.connect(gainNode);
              gainNode.connect(audioContextRef.current!.destination);

              connectionType = 'spatial';
              console.log(`🎧 Spatial audio graph connected for ${userId}: Source -> PannerNode -> GainNode -> Destination`);
            } catch (pannerError) {
              console.warn(`⚠️ PannerNode failed for ${userId}, falling back to basic:`, pannerError);

              // Clean up partial spatial setup
              if (pannerNode) {
                try { pannerNode.disconnect(); } catch { /* ignore */ }
                pannerNode = undefined;
              }

              // Basic Web Audio: MediaElementSource -> GainNode -> Destination
              gainNode = audioContextRef.current!.createGain();
              source.connect(gainNode);
              gainNode.connect(audioContextRef.current!.destination);

              connectionType = 'basic';
              console.log(`🔊 Basic Web Audio graph connected for ${userId}: Source -> GainNode -> Destination`);
            }

            graphSuccessful = true;

            // Step 4: Mute element ONLY after Web Audio graph is successfully connected
            console.log(`🔇 Muting audio element for ${userId} - Web Audio now controls output`);
            audioElement.muted = true;

          } catch (webAudioError) {
            console.error(`❌ Web Audio graph creation failed for ${userId}:`, webAudioError);
            console.warn(`⚠️ Falling back to direct HTMLAudioElement playback for ${userId}`);

            // Clean up any partial Web Audio setup
            if (source) {
              try { source.disconnect(); } catch { /* ignore */ }
              source = undefined;
            }
            if (gainNode) {
              try { gainNode.disconnect(); } catch { /* ignore */ }
              gainNode = undefined;
            }
            if (pannerNode) {
              try { pannerNode.disconnect(); } catch { /* ignore */ }
              pannerNode = undefined;
            }

            // Keep element unmuted for direct playback
            audioElement.muted = false;
            connectionType = 'direct';

            // Create dummy gain node for API compatibility
            gainNode = audioContextRef.current!.createGain();
            gainNode.gain.setValueAtTime(1.0, audioContextRef.current!.currentTime);
          }

          // Step 5: Store connection with full metadata
          const connection: AudioConnection = {
            userId,
            peerConnection: pc,
            audioElement,
            source,
            gainNode,
            pannerNode,
            usingWebAudio: graphSuccessful,
            connectionType
          };
          audioConnectionsRef.current.set(userId, connection);

          // Step 6: Set initial gain
          if (graphSuccessful && gainNode) {
            gainNode.gain.setValueAtTime(1.0, audioContextRef.current!.currentTime);
            console.log(`🎯 Set initial gain for ${userId}: 1.0 (${connectionType} mode)`);
          }

          // Step 7: Comprehensive diagnostics
          console.log(`🔍 Connection established for ${userId}:`, {
            connectionType,
            usingWebAudio: graphSuccessful,
            elementMuted: audioElement.muted,
            elementVolume: audioElement.volume,
            hasSource: !!source,
            hasGainNode: !!gainNode,
            hasPannerNode: !!pannerNode
          });

          // Step 8: Trigger spatial audio update
          console.log(`🔄 Updating spatial audio after connecting ${userId}`);
          updateSpatialAudio();

        } catch (error) {
          console.error(`❌ Critical error setting up audio for user ${userId}:`, error);

          if (error instanceof Error) {
            console.error(`🔍 ERROR: ${error.name} - ${error.message}`);
          }

          // Final cleanup on total failure
          cleanupAudioConnection(userId, "critical error");
          console.warn(`⚠️ Audio completely failed for ${userId}, user will be silent`);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const currentSocket = socket;
          if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
            currentSocket.send(
              JSON.stringify({
                type: "ice_candidate",
                payload: {
                  candidate: event.candidate,
                  targetUserId: userId,
                },
              })
            );
            console.log(`Sent ICE candidate to ${userId}`);
          } else {
            console.warn(`Cannot send ICE candidate to ${userId}: socket not ready`);
          }
        }
      };

      console.log(`Peer connection created and stored for user ${userId}`);
      return pc;
    },
    [initializeAudioContext, localStream, socket, applySpatialSettings]
  );

  useEffect(() => {
    updateSpatialAudio();
  }, [updateSpatialAudio]);

  useEffect(() => {
    const ws = new PartySocket({
      host: process.env.NODE_ENV === "development" ? "localhost:1999" : process.env.NEXT_PUBLIC_PARTYKIT_URL || "koolertawk-party.simonadler1.partykit.dev",
      room: "spatial-chat",
    });

    const handleMessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "room_state":
          console.log(`📊 Room state update:`, {
            users: data.payload.users.map((u: User) => ({
              name: u.name,
              id: u.id,
              audioEnabled: u.audioEnabled,
              seatId: u.seatId
            })),
            totalUsers: data.payload.users.length
          });

          // Check for new users that we need to establish connections with
          // Use refs to avoid stale closure issues
          const currentIsJoined = isJoinedRef.current;
          const currentCurrentUser = currentUserRef.current;
          const currentAudioEnabled = audioEnabledRef.current;

          if (currentIsJoined && currentCurrentUser && currentAudioEnabled) {
            const existingConnections = new Set(audioConnectionsRef.current.keys());
            const newUsers = data.payload.users.filter((u: User) =>
              u.id !== currentCurrentUser.id &&
              u.audioEnabled &&
              !existingConnections.has(u.id)
            );

            console.log(`🔍 Found ${newUsers.length} new users to connect to:`, newUsers.map((u: User) => u.name));

            // Create offers to new users
            newUsers.forEach(async (newUser: User) => {
              try {
                console.log(`🔗 Creating offer for new user ${newUser.id} (${newUser.name})`);
                const pc = await createPeerConnection(newUser.id);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                if (socket && socket.readyState === WebSocket.OPEN) {
                  socket.send(
                    JSON.stringify({
                      type: "audio_offer",
                      payload: {
                        offer,
                        targetUserId: newUser.id,
                      },
                    })
                  );
                  console.log(`📤 Sent offer to new user ${newUser.id} (${newUser.name})`);
                } else {
                  console.warn(`⚠️ Cannot send offer to ${newUser.name}: socket not ready`);
                }
              } catch (error) {
                console.error(`❌ Error creating connection for new user ${newUser.name}:`, error);
              }
            });
          }

          // Deep-clone room state to ensure React sees new references and re-renders
          const clonedRoomState = {
            seats: data.payload.seats.map((seat: Seat) => ({ ...seat })),
            users: data.payload.users.map((user: User) => ({
              ...user,
              position: { ...user.position }
            }))
          };
          setRoomState(clonedRoomState);

          // Update currentUser if it exists and we're joined - use refs to avoid stale closure
          if (currentIsJoined && currentCurrentUser) {
            const updatedCurrentUser = clonedRoomState.users.find((u: User) => u.id === currentCurrentUser.id);
            if (updatedCurrentUser) {
              console.log(`👤 Updating current user position: from (${currentCurrentUser.position.x},${currentCurrentUser.position.y}) to (${updatedCurrentUser.position.x},${updatedCurrentUser.position.y})`);

              // Create a new object to ensure React sees the change
              const newCurrentUser = { ...updatedCurrentUser, position: { ...updatedCurrentUser.position } };
              setCurrentUser(newCurrentUser);

              // Trigger spatial settings update immediately after currentUser position update
              console.log(`🔄 Applying spatial settings after position change`);
              setTimeout(() => applySpatialSettings(), 0);
            }
          }
          break;

        case "chat_message":
          setChatMessages((prev) => [...prev, data.payload]);
          break;

        case "error":
          console.error("❌ Server error:", data.payload.message);
          alert(data.payload.message);
          break;
      }
    };

    ws.onmessage = handleMessage;
    setSocket(ws);

    return () => {
      ws.close();

      // Clean up all peer connections using proper cleanup function
      const connectionsSnapshot = audioConnectionsRef.current;
      const userIds = Array.from(connectionsSnapshot.keys());
      userIds.forEach((userId) => {
        cleanupAudioConnection(userId, "component unmount");
      });

      // Stop local media stream
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          track.stop();
          console.log(`Stopped local ${track.kind} track`);
        });
      }

      // Clean up test audio
      if (testStream) {
        testStream.getTracks().forEach((track) => track.stop());
      }
      if (testAudioRef.current) {
        testAudioRef.current.pause();
      }

      // Close audio context
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, []); // Empty dependency array is intentional - this effect only runs once on mount

  // Handle WebRTC signaling messages
  useEffect(() => {
    if (!socket) return;

    const handleSignaling = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      console.log(`📡 Received signaling message:`, data.type, data.payload);

      switch (data.type) {
        case "audio_offer":
          // Use socket.id instead of currentUser?.id since they should be the same
          if (data.payload.targetUserId === socket.id) {
            console.log(`📥 Received audio offer from ${data.payload.fromUserId}`);
            try {
              const pc = await createPeerConnection(data.payload.fromUserId);
              await pc.setRemoteDescription(data.payload.offer);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              socket.send(
                JSON.stringify({
                  type: "audio_answer",
                  payload: {
                    answer,
                    targetUserId: data.payload.fromUserId,
                  },
                })
              );
              console.log(`📤 Sent audio answer to ${data.payload.fromUserId}`);
            } catch (error) {
              console.error(`❌ Error handling audio offer from ${data.payload.fromUserId}:`, error);
            }
          } else {
            console.log(`⚠️ Ignoring audio offer not for me (target: ${data.payload.targetUserId}, me: ${socket.id})`);
          }
          break;

        case "audio_answer":
          if (data.payload.targetUserId === socket.id) {
            console.log(`📥 Received audio answer from ${data.payload.fromUserId}`);
            const connection = audioConnectionsRef.current.get(data.payload.fromUserId);
            if (connection) {
              try {
                await connection.peerConnection.setRemoteDescription(data.payload.answer);
                console.log(`✅ Set remote description for ${data.payload.fromUserId}`);
              } catch (error) {
                console.error(`❌ Error setting remote description for ${data.payload.fromUserId}:`, error);
              }
            } else {
              console.warn(`⚠️ No connection found for user ${data.payload.fromUserId} when processing answer`);
            }
          } else {
            console.log(`⚠️ Ignoring audio answer not for me (target: ${data.payload.targetUserId}, me: ${socket.id})`);
          }
          break;

        case "ice_candidate":
          if (data.payload.targetUserId === socket.id) {
            console.log(`Received ICE candidate from ${data.payload.fromUserId}`);
            const connectionsSnapshot = audioConnectionsRef.current;
            const connection = connectionsSnapshot.get(data.payload.fromUserId);
            if (connection) {
              try {
                await connection.peerConnection.addIceCandidate(data.payload.candidate);
                console.log(`Added ICE candidate for ${data.payload.fromUserId}`);
              } catch (error) {
                console.error(`Error adding ICE candidate for ${data.payload.fromUserId}:`, error);
              }
            } else {
              console.warn(`No connection found for user ${data.payload.fromUserId} when processing ICE candidate`);
            }
          }
          break;
      }
    };

    // Store reference to avoid issues with removeEventListener
    const socketRef = socket;
    socketRef.addEventListener("message", handleSignaling);

    return () => {
      socketRef.removeEventListener("message", handleSignaling);
    };
  }, [socket, createPeerConnection]);

  const joinRoom = async (seatId: string) => {
    if (!userName || !socket) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      await initializeAudioContext();

      socket.send(
        JSON.stringify({
          type: "join",
          payload: { name: userName, seatId },
        })
      );

      const user: User = {
        id: socket.id!,
        name: userName,
        position: roomState.seats.find((s) => s.id === seatId)?.position || { x: 0, y: 0 },
        seatId,
        audioEnabled: true,
      };

      setCurrentUser(user);
      setIsJoined(true);

      console.log(`👤 User joined at position (${user.position.x}, ${user.position.y}) - basic mode, no listener positioning`);

      // Create peer connections for existing users
      for (const otherUser of roomState.users) {
        if (otherUser.audioEnabled) {
          try {
            console.log(`🔗 Creating offer for existing user ${otherUser.id} (${otherUser.name})`);
            const pc = await createPeerConnection(otherUser.id, stream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.send(
              JSON.stringify({
                type: "audio_offer",
                payload: {
                  offer,
                  targetUserId: otherUser.id,
                },
              })
            );
            console.log(`📤 Sent offer to existing user ${otherUser.id} (${otherUser.name})`);
          } catch (error) {
            console.error(`❌ Error creating peer connection for ${otherUser.id}:`, error);
          }
        } else {
          console.log(`⚠️ Skipping ${otherUser.name} - audio disabled`);
        }
      }
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const moveTo = (seatId: string) => {
    if (!socket || !currentUser) {
      console.warn("⚠️ Cannot move: missing socket or currentUser");
      return;
    }

    const targetSeat = roomState.seats.find(s => s.id === seatId);
    if (!targetSeat) {
      console.warn(`⚠️ Target seat ${seatId} not found`);
      return;
    }

    if (targetSeat.occupied) {
      console.warn(`⚠️ Target seat ${seatId} is occupied by ${targetSeat.userId}`);
      return;
    }

    console.log(`🚶 Moving from ${currentUser.seatId} to ${seatId}`);

    // Simple server-driven update - no optimistic mutations for now
    socket.send(
      JSON.stringify({
        type: "move",
        payload: { seatId },
      })
    );
  };

  const toggleAudio = async () => {
    if (!socket || !localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const newAudioEnabled = !audioTrack.enabled;
      audioTrack.enabled = newAudioEnabled;
      setAudioEnabled(newAudioEnabled);

      console.log(`🎤 Audio ${newAudioEnabled ? 'enabled' : 'disabled'}`);

      // If re-enabling audio, we need to create new offers since tracks were disabled
      if (newAudioEnabled && isJoined && currentUser) {
        console.log("🔄 Re-enabling audio, creating new offers to existing users");

        // Get all users that should have audio connections
        const usersToReconnect = roomState.users.filter(u =>
          u.id !== currentUser.id && u.audioEnabled
        );

        for (const otherUser of usersToReconnect) {
          try {
            // Check if we already have a connection, if so close it first
            const existingConnection = audioConnectionsRef.current.get(otherUser.id);
            if (existingConnection) {
              console.log(`🔄 Closing existing connection with ${otherUser.name} before renegotiation`);
              existingConnection.peerConnection.close();
              existingConnection.audioElement.pause();
              audioConnectionsRef.current.delete(otherUser.id);
            }

            console.log(`🔗 Creating new offer for ${otherUser.name} after audio re-enable`);
            const pc = await createPeerConnection(otherUser.id, localStream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.send(
              JSON.stringify({
                type: "audio_offer",
                payload: {
                  offer,
                  targetUserId: otherUser.id,
                },
              })
            );
            console.log(`📤 Sent new offer to ${otherUser.name}`);
          } catch (error) {
            console.error(`❌ Error reconnecting to ${otherUser.name}:`, error);
          }
        }
      }

      socket.send(
        JSON.stringify({
          type: "toggle_audio",
        })
      );
    }
  };

  const sendChat = () => {
    if (!socket || !chatInput.trim()) return;

    socket.send(
      JSON.stringify({
        type: "chat",
        payload: { message: chatInput },
      })
    );

    setChatInput("");
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8 text-center text-black">Spatial Audio Chat</h1>

          <div className="bg-white border-2 border-black rounded-lg p-6 mb-6">
            <input
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full p-3 border-2 border-black rounded-lg mb-4 text-black bg-white"
            />

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setShowAudioTest(!showAudioTest)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold"
              >
                {showAudioTest ? "🔧 Hide Audio Test" : "🔧 Test Audio"}
              </button>
            </div>

            {showAudioTest && (
              <div className="bg-gray-100 border-2 border-black rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold mb-4 text-black">Audio Test Tools</h3>

                {/* Microphone Test */}
                <div className="mb-6">
                  <h4 className="font-bold text-black mb-2">🎤 Microphone Test</h4>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={testStream ? stopMicTest : startMicTest}
                      className={`px-3 py-2 rounded-lg border-2 border-black font-bold ${
                        testStream
                          ? "bg-red-600 hover:bg-red-700 text-white"
                          : "bg-green-600 hover:bg-green-700 text-white"
                      }`}
                    >
                      {testStream ? "Stop Test" : "Start Test"}
                    </button>

                    {testStream && (
                      <>
                        <button
                          onClick={startRecording}
                          disabled={isRecording}
                          className={`px-3 py-2 rounded-lg border-2 border-black font-bold ${
                            isRecording
                              ? "bg-gray-400 cursor-not-allowed text-white"
                              : "bg-red-600 hover:bg-red-700 text-white"
                          }`}
                        >
                          {isRecording ? "⏺️ Recording..." : "⏺️ Record 5s"}
                        </button>

                        {recordedBlob && (
                          <button
                            onClick={playRecording}
                            disabled={isPlayingTest}
                            className={`px-3 py-2 rounded-lg border-2 border-black font-bold ${
                              isPlayingTest
                                ? "bg-gray-400 cursor-not-allowed text-white"
                                : "bg-purple-600 hover:bg-purple-700 text-white"
                            }`}
                          >
                            {isPlayingTest ? "▶️ Playing..." : "▶️ Play Back"}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {testStream && (
                    <div className="mb-2">
                      <div className="text-sm text-black mb-1">Mic Level: {micLevel}%</div>
                      <div className="w-full bg-gray-300 rounded-full h-4 border border-black">
                        <div
                          className={`h-4 rounded-full transition-all duration-100 ${
                            micLevel > 70
                              ? "bg-red-500"
                              : micLevel > 30
                              ? "bg-yellow-500"
                              : micLevel > 5
                              ? "bg-green-500"
                              : "bg-gray-400"
                          }`}
                          style={{ width: `${Math.min(micLevel, 100)}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-black mt-1">
                        {micLevel > 5 ? "✅ Microphone working" : "❌ No sound detected"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Speaker Test */}
                <div className="mb-4">
                  <h4 className="font-bold text-black mb-2">🔊 Speaker Test</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => playSpeakerTest(440, 0.1)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold text-sm"
                    >
                      🔈 Low Volume
                    </button>
                    <button
                      onClick={() => playSpeakerTest(440, 0.3)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold text-sm"
                    >
                      🔉 Medium Volume
                    </button>
                    <button
                      onClick={() => playSpeakerTest(220, 0.2)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold text-sm"
                    >
                      🎵 Low Tone
                    </button>
                    <button
                      onClick={() => playSpeakerTest(880, 0.2)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold text-sm"
                    >
                      🎵 High Tone
                    </button>
                  </div>
                  <div className="text-xs text-black mt-2">
                    Click buttons to test speaker output at different volumes and frequencies
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border-2 border-black rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Select a Seat</h2>
            <div className="relative w-full aspect-square bg-gray-200 border-2 border-black rounded-lg overflow-hidden">
              {roomState.seats.map((seat) => (
                <button
                  key={seat.id}
                  onClick={() => joinRoom(seat.id)}
                  disabled={seat.occupied || !userName}
                  className={`absolute w-[8%] h-[12%] rounded-full border-2 border-black flex items-center justify-center text-xs font-bold ${
                    seat.occupied
                      ? "bg-red-600 cursor-not-allowed text-white"
                      : "bg-green-600 hover:bg-green-700 cursor-pointer text-white"
                  }`}
                  style={{
                    left: `${seat.position.x - 4}%`,
                    top: `${seat.position.y - 6}%`,
                  }}
                  title={seat.occupied ? `Occupied by ${seat.userId}` : "Available seat"}
                >
                  {seat.occupied ? (
                    <span className="text-white text-xs">👤</span>
                  ) : (
                    <span className="text-white text-xs">💺</span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-sm text-black mt-2 font-semibold">🟢 Available seats • 🔴 Occupied seats</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white border-2 border-black rounded-lg p-6 mb-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-black">Spatial Audio Chat - {currentUser?.name}</h1>
            <div className="flex gap-2 items-center">
              <button
                onClick={toggleAudio}
                className={`px-4 py-2 rounded-lg border-2 border-black font-bold ${
                  audioEnabled ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                {audioEnabled ? "🎤 Mute" : "🔇 Unmute"}
              </button>

              {/* Live mic level indicator */}
              {isJoined && audioEnabled && (
                <div className="flex items-center gap-2 bg-gray-100 border-2 border-black rounded-lg px-3 py-2">
                  <span className="text-sm font-bold text-black">Mic:</span>
                  <div className="w-16 bg-gray-300 rounded-full h-3 border border-black">
                    <div
                      className={`h-3 rounded-full transition-all duration-100 ${
                        liveMicLevel > 70
                          ? "bg-red-500"
                          : liveMicLevel > 30
                          ? "bg-yellow-500"
                          : liveMicLevel > 5
                          ? "bg-green-500"
                          : "bg-gray-400"
                      }`}
                      style={{ width: `${Math.min(liveMicLevel, 100)}%` }}
                    ></div>
                  </div>
                  <span className={`text-xs font-bold ${liveMicLevel > 5 ? "text-green-800" : "text-gray-600"}`}>
                    {liveMicLevel > 5 ? "🟢" : "⚫"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[70vh]">
          <div className="lg:col-span-2 bg-white border-2 border-black rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Room Layout</h2>
            <div className="relative w-full aspect-square bg-gray-200 border-2 border-black rounded-lg overflow-hidden">
              {roomState.seats.map((seat) => {
                const user = roomState.users.find((u) => u.seatId === seat.id);
                const isCurrentUser = user?.id === currentUser?.id;

                return (
                  <button
                    key={seat.id}
                    onClick={() => !seat.occupied && moveTo(seat.id)}
                    disabled={seat.occupied}
                    className={`absolute w-[8%] h-[12%] rounded-full border-2 border-black flex items-center justify-center text-xs font-bold ${
                      isCurrentUser
                        ? "bg-blue-600 text-white"
                        : seat.occupied
                        ? "bg-red-600 text-white cursor-not-allowed"
                        : "bg-green-600 text-white hover:bg-green-700 cursor-pointer"
                    }`}
                    style={{
                      left: `${seat.position.x - 4}%`,
                      top: `${seat.position.y - 6}%`,
                    }}
                    title={user ? `${user.name} ${user.audioEnabled ? "🎤" : "🔇"}` : "Available"}
                  >
                    {user && (
                      <div className="text-center relative">
                        <div>👤</div>
                        {!user.audioEnabled && <div>🔇</div>}
                        {/* Show live mic indicator for current user */}
                        {isCurrentUser && audioEnabled && liveMicLevel > 5 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border border-white animate-pulse"></div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Hearing range indicator for current user */}
              {currentUser && (
                <div
                  className="absolute border-2 border-blue-600 border-dashed rounded-full pointer-events-none transition-all duration-300"
                  style={{
                    left: `${currentUser.position.x - 40}%`,
                    top: `${currentUser.position.y - 40}%`,
                    width: "80%",
                    height: "80%",
                  }}
                />
              )}

              {/* Debug: Show position coordinates and movement tracking */}
              {process.env.NODE_ENV === "development" && currentUser && (
                <>
                  <div
                    className="absolute bg-blue-600 text-white text-xs px-2 py-1 rounded pointer-events-none"
                    style={{
                      left: `${currentUser.position.x}%`,
                      top: `${currentUser.position.y - 8}%`,
                    }}
                  >
                    {Math.round(currentUser.position.x)},{Math.round(currentUser.position.y)}
                  </div>
                  <div
                    className="absolute bg-green-600 text-white text-xs px-2 py-1 rounded pointer-events-none"
                    style={{
                      left: `${currentUser.position.x}%`,
                      top: `${currentUser.position.y + 8}%`,
                    }}
                  >
                    ID: {currentUser.id.slice(-4)}
                  </div>
                </>
              )}
            </div>
            <p className="text-sm text-black mt-2 font-semibold">
              🔵 You • 🟢 Available • 🔴 Occupied • 🎤 Audio enabled • 🔇 Muted
            </p>
            <p className="text-sm text-black font-medium">
              The large dashed circle shows your hearing range. Volume decreases with distance: 🔊 Full (very close) →
              🔉 High → 🔈 Medium → 🔇 Low (far edge).
            </p>
          </div>

          <div className="bg-white border-2 border-black rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 text-black">Chat</h2>
            <div className="h-[40vh] overflow-y-auto bg-gray-200 border-2 border-black rounded-lg p-3 mb-3">
              {chatMessages.map((msg, index) => (
                <div key={index} className="mb-2">
                  <span className="font-bold text-blue-800">{msg.userName}:</span>
                  <span className="ml-2 text-black">{msg.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Type a message..."
                className="flex-1 p-2 border-2 border-black rounded-lg text-black bg-white"
              />
              <button
                onClick={sendChat}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 border-2 border-black font-bold"
              >
                Send
              </button>
            </div>
            <p className="text-xs text-black mt-2 font-medium">
              Chat messages are only visible to users within hearing range.
            </p>
          </div>
        </div>

        <div className="bg-white border-2 border-black rounded-lg p-6 mt-4">
          <h2 className="text-xl font-semibold mb-4 text-black">Users in Room ({roomState.users.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {roomState.users.map((user) => {
              const distance = currentUser
                ? Math.sqrt(
                    Math.pow(user.position.x - currentUser.position.x, 2) +
                      Math.pow(user.position.y - currentUser.position.y, 2)
                  )
                : 0;

              return (
                <div key={user.id} className="p-3 bg-gray-200 border border-black rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-black">{user.name}</span>
                    <span className="text-sm text-black">{user.audioEnabled ? "🎤" : "🔇"}</span>
                  </div>
                  <div className="text-sm text-black font-medium">Seat: {user.seatId}</div>
                  {currentUser && user.id !== currentUser.id && (
                    <div className="text-xs text-black">
                      Distance: {Math.round(distance)}%
                      {distance <= 80 && (
                        <span className="text-green-800 font-bold">
                          {distance <= 15
                            ? " (🔊 Full)"
                            : distance <= 30
                            ? " (🔉 High)"
                            : distance <= 50
                            ? " (🔈 Medium)"
                            : " (🔇 Low)"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
