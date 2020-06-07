// import xray sdk and log context missing errors
const AWSXRay = require('aws-xray-sdk-core');
AWSXRay.capturePromise();
AWSXRay.setContextMissingStrategy("LOG_ERROR");

// instrument the https and aws sdk libraries with xray, import axios
AWSXRay.captureHTTPsGlobal(require('https'));
const https = require('https');
const axios = require("axios");

// import pretty-ms for timestamp printing
const prettyms = require("pretty-ms");

// connect to the ddb table
AWSXRay.captureAWS(require('aws-sdk'));
const AWS = require('aws-sdk');
const ddbclient = new AWS.DynamoDB.DocumentClient();

// set url, ddb table variables and default status code
let ddbtable = process.env.ddbtable;
const url = "https://ipinfo.io/json";
let statusCode = '200';

// retrieve the retrieved content and http status code, print error if needed
const getURL = async url => {
    try {
        const response = await axios.get(url);
        statusCode = response.status;
        return response.data;
    } catch (error) {
        statusCode = error.response.status;
        return error;
    }
};

// store the record in dynamodb
function ddbstore(httpsresp, uptimestr, currenttime, uptimeseconds) {

  // construct dynamodb item with lambda execution details
  var params = {
    TableName: ddbtable,
    Item:{
        "timest": currenttime,
        "lambdauptimesec": uptimeseconds,
        "lambdauptimestr": uptimestr, 
        "rawdata": httpsresp,
        "ip": httpsresp.ip,
        "hostname": httpsresp.hostname,
        "country": httpsresp.country,
        "region": process.env.AWS_REGION,
        "environment": process.env.AWS_EXECUTION_ENV,
        "memorysize": process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
    }
  }

  // put the item into dynamodb, print an error if needed
  ddbclient.put(params, function(err, data) {
    if (err) {
        console.error("unable to add item. error json:", JSON.stringify(err));
    } else {

        // log parameters
        console.log(params);
        console.log("record added item to dynamodb");
    }
  });
};

// main lambda handler
exports.handler = async (event, context) => {

    // retrieve https content
    var httpsresp = await getURL(url);
    
    // get current now timestamp
    var now = new Date();
    var currenttime = now.getTime();

    // get node process lifetime to measure host uptime
    var up = process.uptime().toFixed(0);
    var uptime = prettyms(up * 1000, {compact: true});

    // write record to dynamodb
    ddbstore(httpsresp, uptime, currenttime, up);

    // construct response with status code and uptime
    const response = {
        statusCode: statusCode,
        body: httpsresp,
        uptimestring: uptime,
        uptimeseconds: up 
    };

    // return JSON in indented format
    context.succeed(JSON.stringify(response, null, 2));
};
