// Collections typed by the app's Meteor type provider (@types/meteor, zodern:types or
// Meteor 3.6 native declarations). The fixture only relies on APIs all of them share.
import { Meteor } from "meteor/meteor";
import { Mongo } from "meteor/mongo";

export interface Message {
  _id: string;
  roomId: string;
  text: string;
}
export interface Room {
  _id: string;
  name: string;
}
export interface Member {
  _id: string;
  roomId: string;
  username: string;
}

export const Messages = new Mongo.Collection<Message>("messages");
export const Rooms = new Mongo.Collection<Room>("rooms");
export const Members = new Mongo.Collection<Member>("members");

export function notAuthorized(): Error {
  return new Meteor.Error("not-authorized", "Log in first");
}
