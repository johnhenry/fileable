// import CacheMap from './cache-map.js';
import iterator from './iterator.js'
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import rimraf from 'rimraf';
import {promisify} from 'util';
const rmdir = promisify(rimraf);

const hashContent = (content, algorithm = 'sha256', digestType = 'hex') => {
    const hash = crypto.createHash(algorithm);
    hash.update(content);
    return hash.digest(digest);
};

const defaultOptions = {
    folder_context: [],
    template_context: ''
};
export default async (template,
    {
        folder_context = defaultOptions.folder_context,
        template_context = defaultOptions.template_context,
        cache
    } = defalutOptions) => {
    let hashMap;
    if (cache) {
        hashMap = new CacheMap(cache);
    }

    try {
        for await (const {
            clear,
            folder,
            file,
            content,
            folder_context,
            } of
            iterator(template(), {folder_context, template_context})
        ) {
            const resumes = [];
            if (file) {
                const folderPath = path.join(...folder_context);
                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, {recursive:true});
                }
                fs.writeFileSync(path.join(...folder_context, file), content);
            }
            if (folder) {
                const folderPath = path.join(...folder_context, folder);
                if (!fs.existsSync(folderPath)) {
                    fs.mkdirSync(folderPath, {recursive:true});
                }
            }
            if (clear) {
                const folderPath = path.join(...folder_context, clear);
                if (fs.existsSync(folderPath)) {
                    await rmdir(folderPath);
                }
            }
            // hashMap.set(name, newHash);
        }
    } catch (e) {
        console.log(e)
    } finally {
        //hashMap.flush();
    }
};
