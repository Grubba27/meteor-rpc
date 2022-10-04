import { TasksCollection } from './tasks.collection';
import { tasksByUser } from "../../common/tasks/subscriptions";

tasksByUser.setResolver(function (id) {
  console.log('tasksByUser resolver', id);
  return TasksCollection.find({ userId: this.userId });
})
