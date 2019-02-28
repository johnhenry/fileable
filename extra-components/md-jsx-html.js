import yargs from "yargs";
import fs from "fs";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import pretty from "pretty";
import minifier from "html-minifier";
import promisify from "es6-promisify";
import merge from "deepmerge";
import markdown from "markdown";
import {loadFront}  from "yaml-front-matter";
const readJSX = (filename)=>require(filename).default;
const listToMatrix = (size) => (list) =>{
    const matrix = [];
    let i, k;
    for (i = 0, k = -1; i < list.length; i++) {
        if (i % size === 0) {
            k++;
            matrix[k] = [];
        }
        matrix[k].push(list[i]);
    }
    return matrix;
};
const mdToJSX = array => {
  let key = 0;
  return array.map((element) => {
    if(element === "markdown") return undefined;
    switch(element[0]){
      case "header":
      return React.createElement("h" + element[1].level, {key:key++}, element[2]);
      break;
    case "para":
      return <p key={key++}>{element[1]}</p>;
        break;
    default:
      return undefined;
    break;
    }
  }).filter(_=>_);
};
const getIntro  = content => {
  if(!content.$markdown) return "";
  for(let i = 0; i < content.$markdown.length; i++) if(content.$markdown[i][0] === "para") return content.$markdown[i][1];
  return "";
};
const readMD =
 md => {
  const content = loadFront(md);//Extract Front Matter
  Object.assign(content, {$jsx : mdToJSX( markdown.markdown.parse(content.__content)  ) } );//Parse Markdown
  Object.assign(content, {$intro: getIntro(content)});//Generate Intro
  return content;
};
const templates = new Map();
const app = async ({indir, outdir, prettify=false, minify=false, perpage=1, read=readMD}) => {
  let inpath = path.join(process.cwd(), indir);
  let outpath = path.join(process.cwd(), outdir);
  if(typeof read !== "function"){
    read = require(read);
  }
  if(typeof read !== "function"){
    read = read.default;
  }
  if(typeof prettify !== "function"){
    prettify = prettify ? pretty : _ => _;
    prettify = minify ? $ => minifier.minify($, {
      removeAttributeQuotes: true,
      html5: true,
      minifyCSS: true,
      minifyJS: {
        mangle: true,
        compress: {
          sequences: true,
          dead_code: true,
          conditionals: true,
          booleans: true,
          unused: true,
          if_return: true,
          join_vars: true,
          drop_console: true
        }
      }
    }) : prettify;
  }
  const data = {
    root:{},
    posts:new Map(),
    pages:new Map()
  };
  const written = [];
  const files = fs.readdirSync(inpath);
  let post;
  let index;
  for(let file of files){
    const target = path.join(inpath, file);
    if(fs.statSync(target).isDirectory()){
      // const basename = path.basename(file);
      // if(basename !== "[theme]"){
      //     written.push((await app({
      //       outdir: path.join(outdir, basename),
      //       indir: path.join(indir, basename),
      //       prettify, minify, perpage, read})).written)
      // }
      continue;
    }
    const extname = path.extname(file);
    const basename = path.basename(file, extname);
    const basekey = basename
    switch(extname){
      case ".jsx":
        const template = readJSX(target);
        //templates
        if(basename === "[post]"){
          post = template;
        }else if(basename === "[index]"){
          index = template;
        }else{
          templates.set(basekey, template);
        }
        break;
      case ".md":
        const datum = read(target);
        //data
        if(basename === "[]"){
          data.root = datum;
        }else if(/^\[.+\]$/.test(basename)){
          data.posts.set(basekey, datum)
        }else{
          data.pages.set(basekey, datum);
        }
        break;
      default:
        continue;
    }
  };
  //write posts
  for(let [key, datum] of data.posts){
    const merged = merge(data.root, datum);
    const component = post(merged);
    const text = `<!doctype html>${ReactDOMServer.renderToStaticMarkup(component)}`;
    const dest = `${path.join(outpath, key)}.html`;
    fs.writeFileSync(dest, prettify(text));
    written.push(dest);
  }
  //write index pages
  for(let [key, datum] of listToMatrix(Number(perpage))(data.posts)){
    const merged = merge(data.root, datum);
    const component = index(merged);
    const text = `<!doctype html>${ReactDOMServer.renderToStaticMarkup(component)}`;
    const dest = `${path.join(outpath, key)}.html`;
    fs.writeFileSync(dest, prettify(text));
    written.push(dest);
  }
  //write normal pages
  for(let [key, template] of templates){
    const datum = data.pages.get(key) || {};
    const merged = merge(data.root, datum);
    const component = template(merged);
    const text = `<!doctype html>${ReactDOMServer.renderToStaticMarkup(component)}`;
    const dest = `${path.join(outpath, key)}.html`;
    fs.writeFileSync(dest, prettify(text));
    written.push(dest);
  }
  return {written};
}
app(yargs.argv).then(console.log.bind(console)).catch(console.error.bind(console));
