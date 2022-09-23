import { Meteor } from 'meteor/meteor';
import { Migrations } from 'meteor/percolate:migrations';
import './db/migrations';
import './tasks/tasks.methods';
import './tasks/tasks.publications';
import '../common/tasks/mutations.hooks'
import '../common/tasks/mutations'
/**
 * This is the server-side entry point
 */
Meteor.startup(() => {
  Migrations.migrateTo('latest');
});
