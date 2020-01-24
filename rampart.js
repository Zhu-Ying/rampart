#!/usr/bin/env node

const server = require("./server/server");
const { parser } = require("./server/args");
const { getInitialConfig } = require("./server/config/getInitialConfig");
const { processExistingData } = require("./server/startUp");
const { startBasecalledFilesWatcher } = require("./server/watchBasecalledFiles");
const Datastore = require("./server/datastore").default;
const { updateProtocols } = require("./server/updateProtocols");
const { fatal, trace } = require('./server/utils');

const main = async () => {
    try {
        const args = parser.parseArgs();
        if (args.verbose) global.VERBOSE = true;

        if (args.updateProtocols) {
          await updateProtocols();
          return;
        }

        const {config, pipelineRunners} = getInitialConfig(args);
        global.config = config;
        global.pipelineRunners = pipelineRunners;
        global.datastore = new Datastore();
        global.filesSeen = new Set(); /* files (basenames) seen (FASTQ or CSV) */

        server.run({devClient: args.devClient, ports: args.ports});

        await processExistingData();
        await startBasecalledFilesWatcher();

    } catch (err) {
        trace(err);
        fatal(`Fatal error: ${err.message}`);
    }
};

main();
