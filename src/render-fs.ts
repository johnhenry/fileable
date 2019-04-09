// import CacheMap from './cache-map.ts';
import iterator from './iterator.ts';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import rimraf from 'rimraf';
import { promisify } from 'util';
import { glob } from 'glob';
const rmdir = promisify(rimraf);
const findFiles = promisify(glob);

const defaultOptions = {
    folder_context: '',
    template_context: undefined,
    cache:undefined
};

/**
* Render to File System
* @kind function
* @name renderFS
* @param {object} input
* @example
* ```javascript
* import {renderFS} from 'fileable';
* const main = async () =>
* renderFS(template(), { folder_context: [directory] });
* main();
* ```
*/

export default async (template,
    {
        folder_context = defaultOptions.folder_context,
        template_context = defaultOptions.template_context,
        cache = defaultOptions.cache
    } = defaultOptions) => {
    try {
        for await (const {
            directive,
            target,
            name,
            append,
            content,
            folder_context,
            mode
        } of
            iterator(template, { folder_context, template_context })
        ) {
            switch (directive) {
                case 'FILE': {
                    const folderPath = path.join(folder_context);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                    const fileName = path.join(folderPath, name);
                    if (append) {
                        fs.appendFileSync(fileName, content, { mode });
                    } else {
                        fs.writeFileSync(fileName, content, { mode });
                    }
                } break;
                case 'FOLDER': {
                    const folderPath = path.join(folder_context, name);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                } break;
                case 'CLEAR': {
                    if (target) {
                        let files;
                        if (target[0] !== '!' ) {
                            files = await findFiles(path.join(folder_context, target));
                        } else {
                            files = await findFiles(path.join(folder_context, '**'), { ignore: target.substring(1) });
                        }
                        for (const file of files) {
                            if (fs.lstatSync(file).isDirectory()) {
                                continue;
                            }
                            fs.unlinkSync(file);
                        }
                    } else {
                        const folderPath = path.join(folder_context, target);
                        fs.existsSync(folderPath);
                        if (fs.existsSync(folderPath)) {
                            await rmdir(folderPath);
                        }
                    }
                } break;
                default: {
                    console.log({
                        directive,
                        target,
                        name,
                        append,
                        content,
                        folder_context,
                        mode
                    });
                }
            }
        }
    } catch (e) {
        console.log(e);
    } finally {
        //hashMap.flush();
    }
};
