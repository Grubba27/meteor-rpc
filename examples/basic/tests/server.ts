// Server test entry (meteor test runs only this file and what it imports, not server/main.ts).
// Every test talks to the server over a real DDP connection: DDP.connect(Meteor.absoluteUrl()).
import "/imports/api/server";
import "./probe-module";
import "./browser-module";
import "./methods.test";
import "./publications.test";
import "./modules.test";
import "./rate-limit.test";
