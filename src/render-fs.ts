// import CacheMap from './cache-map.ts';
import iterator from 'fileable-iterator';
import { existsSync, mkdirSync, appendFileSync, writeFileSync, lstatSync, unlinkSync} from 'fs';
import {join} from 'path';
import rimraf from 'rimraf';
import { promisify } from 'util';
import { glob } from 'glob';
const rmdir = promisify(rimraf);
const findFiles = promisify(glob);

/**
* Render file tree to file system
* @kind function
* @name renderFS
* @param {function} input
* @param {object} options
* @param {string} options.folder_context - Folder into which files should be renddered
* @param {string} options.template_context - Location of template. Used to determine relateive
* @example
* ```javascript
* import {renderFS} from 'fileable';
* const main = async () =>
* renderFS(template, { folder_context: '.' });
* main();
* ```
*/

export default async (template,
    {
        folder_context = '',
        template_context = '',
        ignoreWarning = false,
        ignoreError = false,
        dieOnWarning = false,
    } ) => {

    try {
        const context = folder_context;
        for await (const {
            directive,
            target,
            name,
            append,
            content,
            folder_context,
            mode,
            message
        } of
            iterator(template, { folder_context: context, template_context })
        ) {
            switch (directive) {
                case 'FILE': {
                    const folderPath = join(folder_context);
                    if (!existsSync(folderPath)) {
                        mkdirSync(folderPath, { recursive: true });
                    }
                    const fileName = join(folderPath, name);
                    if (append) {
                        appendFileSync(fileName, content, { mode });
                    } else {
                        writeFileSync(fileName, content, { mode });
                    }
                } break;
                case 'FOLDER': {
                    const folderPath = join(folder_context, name);
                    if (!existsSync(folderPath)) {
                        mkdirSync(folderPath, { recursive: true });
                    }
                } break;
                case 'CLEAR': {
                    if (target) {
                        let files;
                        if (target[0] !== '!' ) {
                            files = await findFiles(join(folder_context, target));
                        } else {
                            files = await findFiles(join(folder_context, '**'), { ignore: target.substring(1) });
                        }
                        for (const file of files) {
                            if (lstatSync(file).isDirectory()) {
                                continue;
                            }
                            unlinkSync(file);
                        }
                    } else {
                        const folderPath = join(folder_context, target);
                        if (existsSync(folderPath)) {
                            await rmdir(folderPath);
                        }
                    }
                } break;
                case 'WARNING': {
                    if (!ignoreWarning) {
                        console.log(message);
                        if (dieOnWarning) {
                            throw new Error(message);
                        }
                    }
                } break;
                case 'ERROR': {
                    if (!ignoreError) {
                        console.log(message);
                        throw new Error(message);
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

    }
};
