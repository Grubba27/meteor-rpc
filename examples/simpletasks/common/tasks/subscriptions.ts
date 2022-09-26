import { createPublication } from 'grubba-rpc'
import { z } from "zod";

type Task = {
  _id: string;
  description: string;
  userId: string;
  createdAt: string;
}
const tasksByUser = createPublication('tasks.byUser', z.any()).expect<Task>()

export {
  tasksByUser,
}
