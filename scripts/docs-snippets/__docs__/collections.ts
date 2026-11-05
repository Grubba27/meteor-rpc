// Collections the documentation's examples read and write.
import { Mongo } from "meteor/mongo";

export interface Task {
  _id: string;
  title: string;
  done: boolean;
  owner: string | null;
}
export interface Room {
  _id: string;
  name: string;
}
export interface Message {
  _id: string;
  roomId: string;
  text: string;
  createdAt: Date;
}
export interface AuditEntry {
  _id: string;
  type: "method" | "publication";
  name: string;
  userId: string | null;
  input: unknown;
  at: Date;
}
export interface Invoice {
  _id: string;
  total: number;
}

export const Tasks = new Mongo.Collection<Task>("tasks");
export const Rooms = new Mongo.Collection<Room>("rooms");
export const Messages = new Mongo.Collection<Message>("messages");
export const AuditLog = new Mongo.Collection<AuditEntry>("auditLog");
export const Invoices = new Mongo.Collection<Invoice>("invoices");
