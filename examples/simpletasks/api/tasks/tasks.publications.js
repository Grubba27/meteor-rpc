import { TasksCollection } from './tasks.collection';
import { tasksByUser } from "../../common/tasks/subscriptions";

tasksByUser.setResolver(function () {
  return TasksCollection.find({ userId: this.userId });
})
