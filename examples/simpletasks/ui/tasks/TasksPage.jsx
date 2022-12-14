import { Meteor } from 'meteor/meteor';
import {Tracker} from "meteor/tracker";
import React, { useState } from 'react';
import { TaskForm } from './TaskForm';
import { useTracker, useFind, useSubscribe } from 'meteor/react-meteor-data';
import { TasksHeader } from './TasksHeader';
import { TaskItems } from './TaskItems';
import { TasksCollection } from '../../api/tasks/tasks.collection';
import { tasksByUser } from "../../common/tasks/subscriptions";

/* eslint-disable import/no-default-export */
export default function TasksPage() {
  const [hideDone, setHideDone] = useState(false);
  const isLoading = useSubscribe(tasksByUser.config.name);
  const userId = useTracker(() => Meteor.userId());
  const filter = hideDone ? { done: { $ne: true }, userId } : { userId };
  const tasks = useFind(
    () => TasksCollection.find(filter, { sort: { createdAt: -1 } }),
    [hideDone]
  );
  const pendingCount = TasksCollection.find({
    done: { $ne: true },
    userId,
  }).count();

  return (
    <>
      <TasksHeader />
      <TaskForm />
      <TaskItems
        isLoading={isLoading}
        tasks={tasks}
        pendingCount={pendingCount}
        hideDone={hideDone}
        setHideDone={setHideDone}
      />
    </>
  );
}
