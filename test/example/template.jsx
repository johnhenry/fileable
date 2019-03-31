import React, { Fragment, Component } from "react";

const HEAD = class extends Component {
  render() {
    return <head>
      <title> This is {this.props.name}'s application </title>{" "}
    </head>
  }
};

const template = async (name = 'John') => {
  return (
    <>
      <Clear>
        <File name="index.html">
          &lt;!doctype html&gt;
            <html>
            <HEAD name={name} />
            <body>
              <link href="./index.css" rel="stylesheet" />
              <h1> {name}'s Sample Application</h1>
              <ul>
                <li>
                  <a href="./google.html">Externally Sourced File</a>
                </li>
                <li>
                  <a href="./created">Command Generated File</a>
                </li>
              </ul>
              <script src="./index.js" />
            </body>
          </html>
          Timestamp: <File name="created" cmd="date" />
        </File>
        <File name="index.css">
          {`body{
              color:red;}`}
        </File>
        <File name="index.js">
          window.console.log({`'Hello ${name.trim()}!'`});
          </File>
        <File name="google.html" src="https://www.google.com" />
        <Folder name="docs">
          <File name="readme.md">
            {`# ${name}`}
            this is a sample readme
            </File>
        </Folder>
        <File name="created" cmd="date" />
      </Clear>
    </>
  );
};

export default template;
