import { createMethod } from "grubba-rpc";
import { z } from "zod";


const TaskValidator = z.object({
  description: z.string(),
})
const IDValidator = z.object({
  taskId: z.string(),
})

const insert = createMethod('tasks.insert', TaskValidator).expect<void>()
const remove = createMethod('tasks.remove', IDValidator).expect<void>()
const setChecked = createMethod('tasks.setChecked', IDValidator).expect<void>()


export {
  TaskValidator,
  IDValidator,
  insert,
  remove,
  setChecked,
}
