import { spawn } from 'child_process';
import {join} from 'path';
export const command = 'uninstall <name>';
export const describe = 'Install dependency';
export const builder = {};
export const handler = async ({ name }) => spawn('npm', ['uninstall', '--prefix', join(__dirname, '../../'), name], {
    stdio: 'inherit',
    // cwd: join(__dirname, '../../')
});
