// Copy to imports/api/collections.ts, or use the app's existing collections.
// The client never imports these for meteor-rpc data: publications land in their own collections.
import { Mongo } from "meteor/mongo";

export interface List {
  _id: string;
  name: string;
  ownerId: string;
}

export interface Task {
  _id: string;
  listId: string;
  title: string;
  done: boolean;
  ownerId: string;
  createdAt: Date;
}

export const Lists = new Mongo.Collection<List>("lists");
export const Tasks = new Mongo.Collection<Task>("tasks");
