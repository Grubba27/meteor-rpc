import { Mongo } from "meteor/mongo";

export interface Room {
  _id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  lastMessageAt?: Date;
}

export interface Message {
  _id: string;
  roomId: string;
  userId: string;
  text: string;
  createdAt: Date;
}

export interface Member {
  /** `${roomId}:${userId}`, so joining twice is a no-op. */
  _id: string;
  roomId: string;
  userId: string;
  joinedAt: Date;
}

export const Rooms = new Mongo.Collection<Room>("rooms");
export const Messages = new Mongo.Collection<Message>("messages");
export const Members = new Mongo.Collection<Member>("members");
