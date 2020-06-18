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
let ipres = '';
let httpreq;

const httpurl = "https://ipinfo.io/json";
let statusCode = '200';

// retrieve the retrieved content and http status code, print error if needed
const getURL = async httpurl => {
    try {
        const response = await axios.get(httpurl);
        statusCode = response.status;
        return response.data;

    } catch (error) {
        statusCode = error.response.status;
        return error;
    }
};

// store the record in dynamodb
function ddbstore(httpreq, uptimestr, currenttime, uptimeseconds, reqpath) {

  // construct dynamodb item with lambda execution details
  var params = {
    TableName: ddbtable,
    Item:{
        "timest": currenttime,
        "lambdauptimesec": uptimeseconds,
        "lambdauptimestr": uptimestr, 
        "rawdata": httpreq,
        "ip": httpreq.ip,
        "reqpath": reqpath,
        "hostname": httpreq.hostname,
        "country": httpreq.country,
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
        console.log("record added item to dynamodb");
    }
  });
};

// main lambda handler
exports.handler = async (event, context) => {

    // get the requested url path
    const reqpath = event.rawPath;

    // retrieve https content
    if (reqpath == "/cache") {

        // if the value was not retrieved from cache
        if (ipres == '') {
            
            // request the ip
            var httpreq = await getURL(httpurl);
            ipres = httpreq
            console.log("! cold start - retrieved IP for "+ reqpath + " request");
        
        } else {

            // if value was set, skip the ipinfo request
            var httpreq = ipres
            console.log("* cached - cached ip result for " + reqpath +" request");
            console.log(httpreq)
        }

    } else {

        // regular, non cached request to another ip path, make the ipinfo request
        var httpreq = await getURL(httpurl);
        ipres = httpreq;
        console.log("% non cache request for " + reqpath);
    }

    // get current timestamp
    var now = new Date();
    var currenttime = now.getTime();

    // get node process lifetime to measure host uptime
    var up = Number(process.uptime().toFixed(0));
    var uptime = prettyms(up * 1000, {compact: true});

    // write record to dynamodb
    ddbstore(httpreq, uptime, currenttime, up, httpurl);

    // construct response with status code and uptime
    const response = {
        statusCode: statusCode,
        body: httpreq,
        reqpath: reqpath,
        uptimestring: uptime,
        uptimeseconds: up 
    };

    // print the response
    console.log(response);

    // return JSON in indented format
    context.succeed(JSON.stringify(response, null, 2));
};
