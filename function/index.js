// import xray sdk and log context missing errors
const AWSXRay = require('aws-xray-sdk-core');
AWSXRay.setContextMissingStrategy("LOG_ERROR");

// instrument the https and aws sdk libraries with xray, import axios
AWSXRay.captureHTTPsGlobal(require('https'));
const https = require('https');
const axios = require("axios");

// connect to the ddb table
AWSXRay.captureAWS(require('aws-sdk'));
const AWS = require('aws-sdk');
const ddbclient = new AWS.DynamoDB.DocumentClient();
AWSXRay.capturePromise();

// set url, ddb table and default status code
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

function ddbstore(httpsresp) {
  // get current timestamp
  var now = new Date();
  var timestamp = now.getTime();

  // construct dynamodb item with lambda execution details
  var params = {
    TableName: ddbtable,
    Item:{
        "timest": timestamp,
        "rawdata": httpsresp,
        "ip": httpsresp.ip,
        "hostname": httpsresp.hostname,
        "country": httpsresp.country,
        "region": process.env.AWS_REGION,
        "environment": process.env.AWS_EXECUTION_ENV,
        "memorysize": process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
    }
  }

  // log parameters
  console.log(params);

  // put the item into dynamodb, print an error if needed
  ddbclient.put(params, function(err, data) {
    if (err) {
        console.error("Unable to add item. Error JSON:", JSON.stringify(err));
    } else {
        console.log("Added item:", JSON.stringify(params));
    }
  });
};

// main handler
exports.handler = async (event, context) => {

    // retrieve https content
    const httpsresp = await getURL(url);
    ddbstore(httpsresp);

    // construct response with status code
    const response = {
        statusCode: statusCode,
        body: JSON.stringify(httpsresp)
    };

    // return content
    context.succeed(response);
};
