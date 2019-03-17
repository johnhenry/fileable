//http://2ality.com/2015/08/es6-map-json.html
import fs from 'fs';
import path from 'path';

const mapToJson = (map) => {
    const json = Object.create(null); // TODO: map => json
    for (let [k, v] of map) {
        json[k] = v;
    }
    return JSON.stringify(json);
};
const jsonToMap = (text) => {
    const json = JSON.parse(text);
    const map = new Map();
    for (let k of Object.keys(json)) {
        map.set(k, json[k]);
    }
    return map;
};

const mapFromFilename = (filename) => {
    return jsonToMap(fs.writeReadSync(filename));
};
const mapToFile = (filename, map) => {
    return fs.writeFileSync(filename, mapToJson(map));
};

export default class {
    constructor(filename) {
        this.filename = path.join(process.cwd(), filename);
        this.map = mapFromFilename(filename);
    }
    set(key, value) {
        return this.map.set(key, value);
    }
    get(key) {
        return this.map.get(key);
    }
    delete(key) {
        return this.map.delete(key);
    }
    flush() {
        return mapToFile(this.filename, this.map);
    }
}
