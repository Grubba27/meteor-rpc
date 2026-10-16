// No Meteor type provider: the app has no `meteor/*` declarations at all, so the
// collections are typed with a minimal local shape. meteor-rpc must not need more.

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

interface LocalCursor<TDoc> {
  fetch(): TDoc[];
}
interface LocalCollection<TDoc> {
  find(selector?: Readonly<Record<string, unknown>>): LocalCursor<TDoc>;
}

declare function collection<TDoc>(name: string): LocalCollection<TDoc>;

export const Messages: LocalCollection<Message> = collection<Message>("messages");
export const Rooms: LocalCollection<Room> = collection<Room>("rooms");
export const Members: LocalCollection<Member> = collection<Member>("members");

export function notAuthorized(): Error {
  return new Error("not-authorized");
}
