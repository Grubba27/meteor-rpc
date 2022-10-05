import { createMethod, createModule } from "grubba-rpc";
import { z } from "zod";



const TaskValidator = z.object({
  description: z.string(),
})
const IDValidator = z.object({
  taskId: z.string(),
})

const insert = createMethod('tasks.insert', TaskValidator).expect<number>()

const remove = createMethod('tasks.remove', IDValidator).expect<void>()
const setChecked = createMethod('tasks.setChecked', IDValidator).expect<void>()

// const Tasks = createModule('tasks', {insert, remove, setChecked}).build();

const [TaskModule, setTaskResolver] = createModule('tasks', {insert, remove, setChecked}).safeBuild()
setTaskResolver({ insert: ({description}) => 1 });
setTaskResolver({
  remove: ({taskId}) => {
    console.log(taskId)
  },
  setChecked: ({taskId}) => {
    console.log(taskId)
  }
})
export {
  TaskValidator,
  IDValidator,
  TaskModule,
  setTaskResolver,
  insert,
  remove,
  setChecked,
}
