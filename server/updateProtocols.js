const fs = require('fs');
const path = require('path');
const util = require('util');
var unzipper = require('unzipper');
var fetch = require('node-fetch');
const { verbose, log } = require('./utils');
const streamPipeline = util.promisify(require('stream').pipeline);

/* The registry of available protocols. Currently this is hardcoded
in the RAMPART source but the idea would be to query a JSON document
to get an up-to-date list */
const registry = [
  {
    url: "https://github.com/artic-network/artic-nipah/archive/master.zip",
    dirInRepo: "rampart",
    name: "artic-nipah-1.0"
  },
  {
    url: "https://github.com/artic-network/rampart-denv2/archive/master.zip",
    dirInRepo: "protocol",
    name: "artic-denv2-1.0"
  },
  {
    url: "https://github.com/artic-network/artic-ebov/archive/master.zip",
    dirInRepo: "rampart/IturiEBOV",
    name: "artic-ituri-ebola-2.0"
  },
  {
    url: "https://github.com/artic-network/artic-ebov/archive/master.zip",
    dirInRepo: "rampart/PanEBOV",
    name: "artic-pan-ebola-2.0"
  },
  // {
  //   url: "https://github.com/aineniamh/realtime-polio/archive/master.zip",
  //   dirInRepo: "rampart",
  //   name: "artic-polio-1.1"
  // }
];

const updateProtocols = async () => {
  const zipFile = path.join(__dirname, "..", "protocols", "tmp.zip");

  for (let data of registry) {
    log(`Extracting protocol ${data.name}`)
    const protocolDir = path.join(__dirname, "..", "protocols", data.name);

    await getZipFile(data, zipFile);
    if (fs.existsSync(protocolDir)) {
      verbose("protocols", `Removing existing protocol ${protocolDir}`);
      fs.rmdirSync(protocolDir, { recursive: true });
    }
    fs.mkdirSync(protocolDir)

    // extract relevent folder from the zip file into `protocolDir`
    await extract(zipFile, data.dirInRepo, protocolDir)

    rm(zipFile);
  };

}



function extract(zipFile, dirInRepo, protocolDir) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipFile)
        // see https://www.npmjs.com/package/unzipper
        .pipe(unzipper.Parse())
        .on('entry', function (entry) {
          const fileName = entry.path;

          if (fileName.includes(`/${dirInRepo}/`) && entry.type==="File") {
            const fileToWrite = path.join(protocolDir, fileName.split(`/${dirInRepo}/`)[1]);
            // console.log(fileToWrite)
            verbose("protocols", `creating ${fileToWrite}`);
            if (!fs.existsSync(path.dirname(fileToWrite))) {
              fs.mkdirSync(path.dirname(fileToWrite))
            }
            entry.pipe(fs.createWriteStream(fileToWrite));
          } else {
            entry.autodrain();
          }
        })
        .on("error", (err) => reject(err))
        .on("close", () => resolve());
    });
};


async function getZipFile(data, zipPath) {
  rm(zipPath);
  verbose("protocols", `Downloading ${data.url} -> ${zipPath}`);
  const response = await fetch(data.url);
  if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)
  await streamPipeline(response.body, fs.createWriteStream(zipPath));
}

function rm(path) {
  if (fs.existsSync(path)) {
    fs.unlinkSync(path)
  }
}







module.exports = {updateProtocols};
