/*
 * Copyright (c) 2019 ARTIC Network http://artic.network
 * https://github.com/artic-network/rampart
 *
 * This file is part of RAMPART. RAMPART is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. RAMPART is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 * See the GNU General Public License for more details. You should have received a copy of the GNU General Public License
 * along with RAMPART. If not, see <http://www.gnu.org/licenses/>.
 *
 */

/**
 * Deals with server configuration at startup from command line arguments and configuration
 * files.
 * @type {module:fs}
 */
const fs = require('fs');
const dsv = require('d3-dsv');
// const path = require('path')
const { normalizePath, getAbsolutePath, verbose, log, warn, fatal } = require("./utils");
const { newReferenceColour, newSampleColour } = require("./colours");

const DEFAULT_PROTOCOL_PATH = "default_protocol";
const PROTOCOL_FILENAME= "protocol.json";
const GENOME_CONFIG_FILENAME= "genome.json";
const PRIMERS_CONFIG_FILENAME = "primers.json";
const PIPELINES_CONFIG_FILENAME = "pipelines.json";
const RUN_CONFIG_FILENAME = "run_configuration.json";
const BARCODES_TO_SAMPLE_FILENAME = "barcodes.csv";

const UNMAPPED_LABEL = "unmapped";
const UNASSIGNED_LABEL = "unassigned";

/**
 * Create initial config file from command line arguments - Note that
 * No data has been processed at this point.
 *
 * This will take configuration in the following order:
 *
 * [RAMPART_ROOT]/default_protocol/
 * [PROTOCOL_PATH]/
 * current working directory/
 *
 * the PROTOCOL_PATH is specified as an environment variable `RAMPART_PROTOCOL` or as a
 * command line option `--protocol`
 *
 * Configuration files looked for:
 * `genome.json` - a description of the layout of genes in the genome. Used for visualized
 *      the coverage maps.
 *
 * `primers.json` - a description of the location of amplicons in the current protocol
 *      (for visualization).
 *
 * `pipelines.json` - a list of pipelines available with paths to the Snakemake files. One
 *      pipeline named 'annotator' is used to process reads for RAMPART and must be
 *      present. Other pipelines are used for post-RAMPART processing and analysis.
 *
 * `run_configuration.json` - This file provides the configuration for the current run
 *      (e.g., mapping of barcodes to samples, title of run, descriptions etc). It will
 *      usually be in the current working directory.
 *
 * Some of these options may also be overridden using command line options such as
 * `--barcodeNames`, `--title`, `--basecalledPath`
 *
 */

function ensurePathExists(path, {make=false}={}) {
    if (!fs.existsSync(path)) {
        if (make) {
            log(`Creating path ${path}`);
            fs.mkdirSync(`${path}`, {recursive: true})
        } else {
            throw new Error(`ERROR. Path ${path} doesn't exist.`);
        }
    }
}

function readConfigFile(paths, fileName) {
    let config = {};

    try {
        // iterate over the paths and if a file exists, read it on top of the
        // existing configuration object.
        paths.forEach((path) => {
            const filePath = normalizePath(path) + fileName;
            if (fs.existsSync(filePath)) {
                verbose("config", `Reading ${fileName} from ${path}`);
                const newConfig = JSON.parse(fs.readFileSync(filePath));

                // if any of the subobjects have a path element, update it to be relative to the current file
                Object.values(newConfig).forEach((value) => {
                    if (value.path) {
                        value.path = normalizePath(getAbsolutePath(value.path, {relativeTo: path}));
                    }
                });
                config = {...config, ...newConfig};
                config.path = normalizePath(path); // add the path of the final config file read - for relative paths
            }
        });
    } catch (err) {
        throw new Error(`Error reading file "${fileName}": ${err.message}`);
    }

    return config;
}

function findConfigFile(paths, fileName) {
    let foundFilePath = undefined;

    // iterate over the paths looking for the file, return the path to the last version found.
    paths.forEach( (path) => {
        const filePath = normalizePath(path) + fileName;
        if (fs.existsSync(filePath)) {
            foundFilePath = filePath;
        }
    });

    return foundFilePath;
}

function assert(item, message) {
    if (!item) {
        throw new Error(message);
    }
}

function checkPipeline(config, pipeline, index = 0, giveWarning = false) {

    let message = undefined;

    if (!pipeline.name) {
        message = `is missing name`;
    }

    if (!message && !pipeline.path) {
        message = `is missing the path`;
    }

    if (!message && !fs.existsSync(pipeline.path)) {
        message = `path doesn't exist`;
    }

    if (!message && !fs.existsSync(pipeline.path + "Snakefile")) {
        message = `Snakefile doesn't exist`;
    }

    if (!message) {
        if (!pipeline.config_file) {
            pipeline.config_file = "config.yaml";
        }

        pipeline.config = getAbsolutePath(pipeline.config_file, {relativeTo: pipeline.path});
        pipeline.configOptions = {};

        if (!fs.existsSync(pipeline.config)) {
            message = `config file doesn't exist`;
        }
    }

    if (message) {
        if (giveWarning) {
            warn(`pipeline '${pipeline.name ? pipeline.name : index + 1}' ${message} - pipeline will be ignored`);
            pipeline.ignore = true;
        } else {
            throw new Error(`pipeline '${pipeline.name}' ${message}`);
        }
    }

}

const getBarcodesInConfig = (config) => {
    const barcodesDefined = new Set();
    config.run.samples.forEach((s) => {
        s.barcodes.forEach((b) => {
            barcodesDefined.add(b);
        })
    })
    return barcodesDefined;
}

function getInitialConfig(args) {
    const serverDir = __dirname;
    const rampartSourceDir = serverDir.substring(0, serverDir.length - 7); // no trailing slash

    const defaultProtocolPath = getAbsolutePath(DEFAULT_PROTOCOL_PATH, {relativeTo: rampartSourceDir});
    //verbose("config", `Default protocol path: ${defaultProtocolPath}`);

    const pathCascade = [
        normalizePath(defaultProtocolPath) // always read config from the default protocol
    ];

    const userProtocol = args.protocol || (process.env.RAMPART_PROTOCOL || undefined);

    if (userProtocol) {
        const userProtocolPath = getAbsolutePath(userProtocol, {relativeTo: process.cwd()});
        //verbose("config", `Protocol path: ${userProtocolPath}`);
        pathCascade.push(normalizePath(userProtocolPath));
    }

    pathCascade.push("./"); // add current working directory

    const config = {
        run: {
            title: `Started @ ${(new Date()).toISOString()}`,
            annotatedPath: "annotations",
            clearAnnotated: false,
            simulateRealTime: 0,
            samples: []
        }
    };

    config.protocol = readConfigFile(pathCascade, PROTOCOL_FILENAME);
    config.genome = readConfigFile(pathCascade, GENOME_CONFIG_FILENAME);
    config.primers = readConfigFile(pathCascade, PRIMERS_CONFIG_FILENAME);
    config.pipelines = readConfigFile(pathCascade, PIPELINES_CONFIG_FILENAME);
    config.run = { ...config.run, ...readConfigFile(pathCascade, RUN_CONFIG_FILENAME) };

    /* overwrite any title with a command-line specified one */
    if (args.title) {
        config.run.title = args.title;
    }


    /* set up sample information. It's ok to leave this blank, as we observe "new" barcodes
    in the data then this will be updated. This is the _only_ place we set up the links
    between barcodes and samples in order to prevent out-of-sync bugs */
    if (config.run.samples) {
        // TODO: error checking
    }
    // override with barcode names provided via CSV
    const barcodeFile = findConfigFile(pathCascade, BARCODES_TO_SAMPLE_FILENAME);
    if (barcodeFile) {
      setBarcodesFromFile(config, barcodeFile);
    }
    // override with any barcode names on the arguments
    if (args.barcodeNames) {
        const newBarcodesToSamples = [];
        args.barcodeNames.forEach((raw) => {
            let [barcode, name] = raw.split('=');
            if (!name) name=barcode;
            newBarcodesToSamples.push([barcode, name]);
        });
        modifySamplesAndBarcodes(config, newBarcodesToSamples);
    }

    /* add in colours (this lends itself nicely to one day allowing them to be specified 
        in the config - the reason we don't yet do this is that colours which aren't in
        the colour picker will cause problems. */
    config.run.samples.forEach((s, i) => {
        s.colour = newSampleColour(s.name);
    })

    // todo - check config objects for correctness
    assert(config.genome, "No genome description has been provided");
    assert(config.genome.label, "Genome description missing label");
    assert(config.genome.length, "Genome description missing length");
    assert(config.genome.genes, "Genome description missing genes");

    config.genome.referencePanel = [{
        name: UNMAPPED_LABEL,
        description: "Reads that didn't map to any reference",
        display: true
    }];

    assert(config.pipelines, "No pipeline configuration has been provided");
    assert(config.pipelines.annotation, "Read proccessing pipeline ('annotation') not defined");
    ensurePathExists(config.pipelines.path);

    if (args.basecalledPath) {
        /* overwrite any JSON defined path with a command line arg */
        config.run.basecalledPath = args.basecalledPath;
    }

    try {
        if (!config.run.basecalledPath) {
            fatal(`No directory of basecalled reads specified in startup configuration`)
        }
        config.run.basecalledPath = normalizePath(getAbsolutePath(config.run.basecalledPath, {relativeTo: process.cwd()}));
        verbose("config", `Basecalled path: ${config.run.basecalledPath}`);
    } catch (err) {
        console.error(err.message);
        // fatal(`Error finding / accessing the directory of basecalled reads ${config.run.basecalledPath}`)
        fatal(`No directory of basecalled reads specified in startup configuration`)
    }

    if (args.annotatedDir) {
        config.run.annotatedPath = args.annotatedDir;
    }
    config.run.annotatedPath = normalizePath(getAbsolutePath(config.run.annotatedPath, {relativeTo: process.cwd()}));
    config.run.workingDir = process.cwd();

    ensurePathExists(config.run.annotatedPath, {make: true});
    verbose("config", `Annotated path: ${config.run.annotatedPath}`);

    if (args.clearAnnotated) {
        config.run.clearAnnotated = args.clearAnnotated;
    }
    if (config.run.clearAnnotated){
        verbose("config", "Flag: 'Clearing annotation directory' enabled");
    }

    if (args.simulateRealTime) {
        config.run.simulateRealTime = args.simulateRealTime;
    }
    if (config.run.simulateRealTime > 0){
        verbose("config", `Simulating real-time appearance of reads every ${config.run.simulateRealTime} seconds`);
    }

    checkPipeline(config, config.pipelines.annotation, 0);

    if (config.pipelines.annotation.requires) {
        // find any file that the pipeline requires
        config.pipelines.annotation.requires.forEach( (requirement) => {
            let filepath = findConfigFile(pathCascade, requirement.file);

            if (requirement.config_key === 'references_file' && args.referencesPath) {
                // override the references path if specified on the command line
                filepath = getAbsolutePath(args.referencesPath, {relativeTo: process.cwd()});
                ensurePathExists(filepath);
            }

            requirement.path = filepath;

            if (!filepath) {
                // throw new Error(`Unable to find required file, ${requirement.file}, for pipeline, '${config.pipelines.annotation.name}'`);
                fatal(`Unable to find required file, ${requirement.file}, for pipeline, '${config.pipelines.annotation.name}'\n`);
            }

            // set this in config.run so the UI can find it.
            config.run.referencesPanel = filepath;

        });
    }

    // Add any annotationOptions from the protocol config file
    if (config.protocol.annotationOptions) {
        config.pipelines.annotation.configOptions = { ...config.pipelines.annotation.configOptions, ...config.protocol.annotationOptions };
    }

    // Add any annotationOptions options from the run config file
    if (config.run.annotationOptions) {
        config.pipelines.annotation.configOptions = { ...config.pipelines.annotation.configOptions, ...config.run.annotationOptions };
    }

    // if any samples have been set (and therefore associated with barcodes) then we limit the run to those barcodes
    if (config.run.samples.length) {
        config.pipelines.annotation.configOptions["limit_barcodes_to"] = [...getBarcodesInConfig(config)].join(',');
        verbose("config", `Limiting barcodes to: ${config.pipelines.annotation.configOptions["limit_barcodes_to"]}`)
    }

    // Add any annotationOptions options from the command line
    if (args.annotationOptions) {
        // add pass-through options to the annotation script
        args.annotationOptions.forEach( value => {
            const values = value.split("=");
            config.pipelines.annotation.configOptions[values[0]] = (values.length > 1 ? values[1] : "");
        });
    }

    // If other pipelines are specified, check them
    config.pipelines.processing = Object.values(config.pipelines)
        .filter( (pipeline) => pipeline.processing );
    config.pipelines.processing.forEach( (pipeline, index) => {
        checkPipeline(config, pipeline, index, true);
    });

    /* display options */
    config.display = {
        numCoverageBins: 1000, /* how many bins we group the coverage stats into */
        readLengthResolution: 10,
        referenceMapCountThreshold: 5,
        maxReferencePanelSize: 10,
        coverageThresholds: {
            // ">200x": 200, "0x": 0
            // ">2000x": 2000, ">200x": 200, ">20x": 20, "0x": 0
            ">1000x": 1000, ">100x": 100, ">10x": 10, "0x": 0
        },
        filters: {},
        // filters: {"maxReadLength": 600}, // TMP TODO
        relativeReferenceMapping: false,
        logYAxis: false
    };

    // Add any display options from the protocol config file
    if (config.protocol.displayOptions) {
        config.display = { ...config.display, ...config.protocol.displayOptions };
    }

    // Add any display options options from the run config file
    if (config.run.displayOptions) {
        config.display = { ...config.display, ...config.run.displayOptions };
    }

    if (args.referencesLabel) {
        config.display.referencesLabel = args.referencesLabel;
    }

    return config;
};

/**
 * A reducer to update the global config object via client provided data.
 * The `action` here doesn't (necessarily) have a `type`, we instead interogate
 * the properties of the action make (potentially multiple) modifications to the
 * config object.
 * @param {Object} clientSettings new config paramaters sent from the client
 * @returns {undefined}
 * @sideEffect (1) modifies global.config in place
 *             (2) notifies client of updated config
 *             (3) [potentially] triggers data updates & notifies client of updated data
 */
const modifyConfig = (action) => {
    verbose("config", `Modifying the following parts of the config: ${Object.keys(action).join(", ")}`);

    let dataHasChanged = false;

    if (action.hasOwnProperty("logYAxis")) {
        global.config.display.logYAxis = action.logYAxis;
    }

    if (action.hasOwnProperty("relativeReferenceMapping")) {
        global.config.display.relativeReferenceMapping = action.relativeReferenceMapping;
    }

    if (action.hasOwnProperty("filters")) {
        global.config.display.filters = action.filters; // TODO: check for equality?
        global.datastore.changeReadFilters();
        dataHasChanged = true;
    }

    if (action.hasOwnProperty("barcodeToSamples")) {
        modifySamplesAndBarcodes(global.config, action.barcodeToSamples);
        global.config.run.samples.forEach((s, i) => {
            if (!s.colour) {
                s.colour = newSampleColour(s.name);
            }
        })
        global.datastore.recalcSampleData();
        dataHasChanged = true;
    }

    global.CONFIG_UPDATED();
    if (dataHasChanged) global.NOTIFY_CLIENT_DATA_UPDATED();
};


// const modifyConfig = ({config: newConfig, refFasta, refJsonPath, refJsonString}) => {

//     /* if client is sending us the references file */
//     if (refFasta) {
//         if (global.config.referencePanelPath) {
//             throw new Error("Shouldn't be able to supply a reference panel fasta when referencePanelPath exists");
//         }
//         newConfig.referencePanelPath = path.join(global.config.rampartTmpDir, "referencePanel.fasta");
//         fs.writeFileSync(newConfig.referencePanelPath, refFasta);
//         newConfig.referencePanel = parseReferenceInfo(newConfig.referencePanelPath);
//     }

//     /* if client is sending us JSON file -- either as a complete file-in-a-string or as a path to load */
//     if (refJsonString || refJsonPath) {
//         if (global.config.referenceConfigPath) {
//             throw new Error("Shouldn't be able to supply a reference config JSON when referenceConfigPath exists");
//         }

//         if (refJsonPath) {
//             ensurePathExists(refJsonPath);
//             newConfig.referenceConfigPath = refJsonPath;
//         } else {
//             newConfig.referenceConfigPath = path.join(global.config.rampartTmpDir, "reference.json");
//             fs.writeFileSync(newConfig.referenceConfigPath, refJsonString);
//         }

//         /* parse the "main reference" configuration file (e.g. primers, genes, ref seq etc) */
//         newConfig.reference = JSON.parse(fs.readFileSync(newConfig.referenceConfigPath)).reference;

//         /* the python mapping script needs a FASTA of the main reference */
//         newConfig.coordinateReferencePath = save_coordinate_reference_as_fasta(newConfig.reference.sequence, global.config.rampartTmpDir);
//     }

//     global.config = Object.assign({}, global.config, newConfig);

//     if (refFasta || refJsonPath || refJsonString) {
//         /* try to start the mapper, which may not be running due to insufficent
//         config information. It will exit gracefully if required */
//         mapper();
//     }
// };


/**
 * RAMPART doesn't know what references are out there, we can only add them as we see them
 * This updates the config store of the references, and triggers a client update if there are changes
 * @param {set} referencesSeen
 */
const updateReferencesSeen = (referencesSeen) => {
    const changes = [];
    const referencesInConfig = new Set([...global.config.genome.referencePanel.map((x) => x.name)]);
    referencesSeen.forEach((ref) => {
        if (ref !== UNMAPPED_LABEL && !referencesInConfig.has(ref)) {
            global.config.genome.referencePanel.push({
                name: ref,
                description: "to do",
                colour: newReferenceColour(ref),
                display: false
            });
            changes.push(ref);
        }
    });
    if (changes.length) {
        verbose("config", `new references seen: ${changes.join(", ")}`);
        global.CONFIG_UPDATED();
    }
};

const updateWhichReferencesAreDisplayed = (refsToDisplay) => {
    let changed = false;
    for (const refInfo of Object.values(global.config.genome.referencePanel)) {
        if (refInfo.display && !refsToDisplay.includes(refInfo.name)) {
            changed = true;
            refInfo.display = false;
        }
        if (!refInfo.display && refsToDisplay.includes(refInfo.name)) {
            changed = true;
            refInfo.display = true;
        }
    }
    if (changed) {
        verbose("config", `updated which refs in the reference panel should be displayed`);
        global.CONFIG_UPDATED();
    }
};


/**Modify the config to reflect new data.
 * `newBarcodesToSamples` has format [[bc, name], ...]
 * TODO: preserve ordering where possible -- e.g. a name swap for 1 barcode shouln't change order
 */
function modifySamplesAndBarcodes(config, newBarcodesToSamples) {

    /* step 1: remove already-set barcodes which match those on cmd line */
    const newBarcodes = newBarcodesToSamples.map((d) => d[0]);
    config.run.samples.forEach((sample) => {
        sample.barcodes = sample.barcodes.filter((b) => !newBarcodes.includes(b))
    })

    /* step 2: add in barcodes to existing samples or create new samples as needed */
    newBarcodesToSamples.forEach(([newBarcode, newSampleName]) => {
        let added = false
        config.run.samples.forEach((sample) => {
            if (sample.name === newSampleName) {
                sample.barcodes.push(newBarcode);
                added = true;
            }
        })
        if (!added) {
            config.run.samples.push({name: newSampleName, description: "", barcodes: [newBarcode]})
        }
    });

    /* step 3: remove samples without any barcodes */
    config.run.samples = config.run.samples.filter((s) => !!s.barcodes.length);
}

/**
 * Set the samples if a barcode CSV file is provided.
 * This will overwrite any samples currently in the config.
 */
function setBarcodesFromFile(config, barcodeFile) {
    try {
        verbose("config", `Reading sample to barcode mapping from ${barcodeFile}`);
        const samples = dsv.csvParse(fs.readFileSync(barcodeFile).toString());

        const sampleMap = samples.reduce( (sampleMap, d) => {
            sampleMap[d.sample] = (d.sample in sampleMap ? [...sampleMap[d.sample], d.barcode] : [d.barcode]);
            return sampleMap;
        }, {});
        if (config.run.samples.length) {
          verbose("config", `Overriding existing barcode - sample name mapping`);
        }
        config.run.samples = Object.keys(sampleMap).map((d) => {
            return {
                'name': d,
                'description': "",
                'barcodes': sampleMap[d]
            };
        });
    } catch (err) {
        warn("Unable to read barcode to sample map file: " + barcodeFile)
    }
}

module.exports = {
    getInitialConfig,
    modifyConfig,
    updateWhichReferencesAreDisplayed,
    updateReferencesSeen,
    UNMAPPED_LABEL,
    UNASSIGNED_LABEL,
    getBarcodesInConfig
};
