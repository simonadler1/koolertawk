import type * as Party from "partykit/server";

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

interface JoinPayload {
  name: string;
  seatId: string;
}

interface MovePayload {
  seatId: string;
}

interface WebRTCPayload {
  targetUserId: string;
  fromUserId?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidate;
}

interface ChatPayload {
  message: string;
}

interface MessageData {
  type: 'join' | 'leave' | 'move' | 'audio_offer' | 'audio_answer' | 'ice_candidate' | 'toggle_audio' | 'chat';
  payload?: JoinPayload | MovePayload | WebRTCPayload | ChatPayload;
}

export default class SpatialAudioServer implements Party.Server {
  private users = new Map<string, User>();
  private seats: Seat[] = [];
  private readonly MAX_HEARING_DISTANCE = 80; // percentage - much larger hearing range

  constructor(readonly room: Party.Room) {
    // Initialize a 4x4 grid of seats
    this.initializeSeats();
  }

  private initializeSeats() {
    const rows = 4;
    const cols = 4;
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        this.seats.push({
          id: `seat-${row}-${col}`,
          position: {
            x: 20 + (col * 20), // 20%, 40%, 60%, 80%
            y: 20 + (row * 20)  // 20%, 40%, 60%, 80%
          },
          occupied: false
        });
      }
    }
  }

  private calculateDistance(pos1: Position, pos2: Position): number {
    return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2));
  }

  private getUsersInRange(user: User): User[] {
    const usersInRange: User[] = [];
    
    this.users.forEach((otherUser) => {
      if (otherUser.id !== user.id && otherUser.audioEnabled) {
        const distance = this.calculateDistance(user.position, otherUser.position);
        if (distance <= this.MAX_HEARING_DISTANCE) {
          usersInRange.push(otherUser);
        }
      }
    });

    return usersInRange;
  }

  private broadcastRoomState() {
    const roomState = {
      seats: this.seats,
      users: Array.from(this.users.values())
    };

    this.room.broadcast(JSON.stringify({
      type: 'room_state',
      payload: roomState
    }));
  }

  onConnect(conn: Party.Connection) {
    console.log(`User connected: ${conn.id}`);
    
    // Send current room state to new user
    const roomState = {
      seats: this.seats,
      users: Array.from(this.users.values())
    };

    conn.send(JSON.stringify({
      type: 'room_state',
      payload: roomState
    }));
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const data: MessageData = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          if (data.payload) {
            this.handleUserJoin(sender.id, data.payload as JoinPayload);
          }
          break;

        case 'move':
          if (data.payload) {
            this.handleUserMove(sender.id, data.payload as MovePayload);
          }
          break;

        case 'audio_offer':
        case 'audio_answer':
        case 'ice_candidate':
          this.handleWebRTCSignaling(sender.id, data);
          break;

        case 'toggle_audio':
          this.handleToggleAudio(sender.id);
          break;

        case 'chat':
          if (data.payload) {
            this.handleChatMessage(sender.id, data.payload as ChatPayload);
          }
          break;
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  private handleUserJoin(userId: string, payload: JoinPayload) {
    const seat = this.seats.find(s => s.id === payload.seatId);
    
    if (!seat || seat.occupied) {
      this.room.getConnection(userId)?.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Seat not available' }
      }));
      return;
    }

    // Mark seat as occupied
    seat.occupied = true;
    seat.userId = userId;

    // Create user
    const user: User = {
      id: userId,
      name: payload.name,
      position: seat.position,
      seatId: payload.seatId,
      audioEnabled: true
    };

    this.users.set(userId, user);
    this.broadcastRoomState();

    console.log(`User ${payload.name} joined and took seat ${payload.seatId}`);
  }

  private handleUserMove(userId: string, payload: MovePayload) {
    const user = this.users.get(userId);
    if (!user) return;

    const newSeat = this.seats.find(s => s.id === payload.seatId);
    if (!newSeat || newSeat.occupied) {
      this.room.getConnection(userId)?.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Seat not available' }
      }));
      return;
    }

    // Free old seat
    if (user.seatId) {
      const oldSeat = this.seats.find(s => s.id === user.seatId);
      if (oldSeat) {
        oldSeat.occupied = false;
        oldSeat.userId = undefined;
      }
    }

    // Occupy new seat
    newSeat.occupied = true;
    newSeat.userId = userId;

    // Update user
    user.position = newSeat.position;
    user.seatId = payload.seatId;

    this.broadcastRoomState();
  }

  private handleWebRTCSignaling(userId: string, data: MessageData) {
    const user = this.users.get(userId);
    if (!user) {
      console.warn(`WebRTC signaling from unknown user: ${userId}`);
      return;
    }

    const webrtcPayload = data.payload as WebRTCPayload;
    if (!webrtcPayload) return;

    switch (data.type) {
      case 'audio_offer':
        // For offers, send directly to the target user regardless of range initially
        // This ensures initial connection establishment
        const targetConnection = this.room.getConnection(webrtcPayload.targetUserId);
        if (targetConnection) {
          targetConnection.send(JSON.stringify({
            ...data,
            payload: {
              ...webrtcPayload,
              fromUserId: userId
            }
          }));
          console.log(`Forwarded audio offer from ${userId} to ${webrtcPayload.targetUserId}`);
        } else {
          console.warn(`Target user ${webrtcPayload.targetUserId} not found for audio offer`);
        }
        break;

      case 'audio_answer':
      case 'ice_candidate':
        // For answers and ICE candidates, send directly to target
        const answerTargetConnection = this.room.getConnection(webrtcPayload.targetUserId);
        if (answerTargetConnection) {
          answerTargetConnection.send(JSON.stringify({
            ...data,
            payload: {
              ...webrtcPayload,
              fromUserId: userId
            }
          }));
          console.log(`Forwarded ${data.type} from ${userId} to ${webrtcPayload.targetUserId}`);
        } else {
          console.warn(`Target user ${webrtcPayload.targetUserId} not found for ${data.type}`);
        }
        break;
    }
  }

  private handleToggleAudio(userId: string) {
    const user = this.users.get(userId);
    if (!user) return;

    user.audioEnabled = !user.audioEnabled;
    this.broadcastRoomState();
  }

  private handleChatMessage(userId: string, payload: ChatPayload) {
    const user = this.users.get(userId);
    if (!user) return;

    // Only send chat to users in range
    const usersInRange = this.getUsersInRange(user);
    
    const chatData = {
      type: 'chat_message',
      payload: {
        userId,
        userName: user.name,
        message: payload.message,
        position: user.position
      }
    };

    usersInRange.forEach(targetUser => {
      this.room.getConnection(targetUser.id)?.send(JSON.stringify(chatData));
    });

    // Also send to sender
    this.room.getConnection(userId)?.send(JSON.stringify(chatData));
  }

  onClose(conn: Party.Connection) {
    const user = this.users.get(conn.id);
    if (user && user.seatId) {
      // Free the seat
      const seat = this.seats.find(s => s.id === user.seatId);
      if (seat) {
        seat.occupied = false;
        seat.userId = undefined;
      }
    }

    this.users.delete(conn.id);
    this.broadcastRoomState();
    
    console.log(`User ${conn.id} disconnected`);
  }
}

SpatialAudioServer satisfies Party.Worker;
