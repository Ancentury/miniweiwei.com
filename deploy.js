const fs = require('fs');
const upath = require('upath');
const util = require('util');
const glob = util.promisify(require('glob'));
const SftpClient = require('ssh2-sftp-client');
const sftp = new SftpClient();

const remotePathBase = '/var/www/miniweiwei';
let localPublicDir = upath.join(process.cwd(), 'public');
const ignoredRemoteItems = new Set(['.well-known', 'cgi-bin', '.htaccess', 'favicon.ico']);

let itemsToUpload = [];

if (!process.env.FTP_DEPLOY_HOST) throw new Error('FTP_DEPLOY_HOST not set');
if (!process.env.FTP_DEPLOY_PORT) throw new Error('FTP_DEPLOY_PORT not set');
if (!process.env.FTP_DEPLOY_USERNAME) throw new Error('FTP_DEPLOY_USERNAME not set');
//if (!process.env.FTP_DEPLOY_PASSWORD) throw new Error('FTP_DEPLOY_PASSWORD not set');
if (!process.env.FTP_DEPLOY_PRIVATEKEY) throw new Error('FTP_DEPLOY_PRIVATEKEY not set');

sftp.connect({
    host: process.env.FTP_DEPLOY_HOST,
    port: process.env.FTP_DEPLOY_PORT,
    username: process.env.FTP_DEPLOY_USERNAME,
    //password: process.env.FTP_DEPLOY_PASSWORD
    privateKey: fs.readFileSync(process.env.FTP_DEPLOY_PRIVATEKEY)
})
    .then(() => scanLocalFiles())
    .then(items => {
        if (!items || items.length < 1) throw new Error('Nothing to upload!');

        itemsToUpload = items;
    })
    .then(() => cleanRemote())
    .then(() => createDirectoriesFor(itemsToUpload))
    .then(() => sftp.end())
    .catch(err => {
        sftp.end();
        console.error(err);
        process.exit(1);
    });

function scanLocalFiles() {


    return glob(`${localPublicDir}/**/*`).then(globMatches => {
        let items = globMatches.map(path => {
            return {
                isDirectory: fs.lstatSync(path).isDirectory(),
                localPath: path,
                remotePath: upath.join(
                    remotePathBase,
                    upath.relative(localPublicDir, path)
                )
            }
        });
        return items;
    });
}

function cleanRemote() {
    console.log('\nCleaning remote server');

    return sftp
        .list(remotePathBase)
        .then(objectList => {
            objectList = objectList.filter(obj => !ignoredRemoteItems.has(obj.name));

            let directoriesToRemove = objectList
                .filter(obj => obj.type === 'd')
                .map(obj => obj.name);

            let filesToRemove = objectList
                .filter(obj => obj.type === '-')
                .map(obj => obj.name);

            let operations = directoriesToRemove
                .map(dir => sftp
                    .rmdir(upath.join(remotePathBase, dir), true)
                    .then(() => console.log(`Removed directory ${dir}`))
                )
                .concat(filesToRemove.map(file =>
                    sftp.delete(upath.join(remotePathBase, file))
                        .then(() => console.log(`Removed file ${file}`))
                ));
            return Promise.all(operations);
        })
}

function createDirectoriesFor(items) {
    console.log('Creating directories');
    sftp.on('upload', info => {
        console.log(`Listener: Uploaded ${info.source}`);
    });
    return sftp.uploadDir(localPublicDir, remotePathBase);
}