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
let ipres = "";
let statusCode = '200';
const httpurl = "https://ipinfo.io/json";

// retrieve the retrieved content and http status code, print error if needed
const getURL = async httpurl => {
    try {
		httpreq = await axios.get(httpurl);
		statusCode = httpreq.statusCode;
		return httpreq.data;


    } catch (error) {
		httpreq = ipres;
		statusCode = httpreq.statusCode;
		return error;
    }
};

const ddbget = async (ts) => {
	let seg = AWSXRay.getSegment().addNewSubsegment("ddbget");
	let ip;
	let timest;
	let uptime;

	// dynamodb query parameters
	var params = {
		TableName : ddbtable,
		KeyConditionExpression: "#ts = :y",
		ExpressionAttributeNames:{
			"#ts": "timest"
		},
		ExpressionAttributeValues: {
			":y": Number(ts)
		}
	};

	// execute the dynamodb query and print results
	await ddbclient.query(params, function(err, data) {
		
		if (err) {
			console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
			return "error";

		} else {
			data.Items.forEach(function(item) {
				timest = item.timest;
				uptime = item.lambdauptimesec;
				ip = item.ip;

				console.log("timest" + timest + " - lambdauptimesec " + uptime + " - ip " + ip);
				return "timest " + timest + " - uptime " + uptime + " - " + ip;

			});
		}
	}).promise();

	seg.addAnnotation('clientip', ip);
	seg.addAnnotation('urlpath', '/get');
	seg.addAnnotation('timest', timest);
	seg.close();

	// return the timestamp and lambda uptime
	return "successful get - timest " + timest + " - uptime " + uptime + " - " + ip;

};

// store the record in dynamodb
const ddbput = async (uptimestr, currenttime, uptimeseconds) => {
	let seg = AWSXRay.getSegment().addNewSubsegment("ddbput");

	// construct dynamodb item with lambda execution details
	var params = {
		TableName: ddbtable,
		Item:{
			"timest": currenttime,
			"lambdauptimesec": uptimeseconds,
			"lambdauptimestr": uptimestr,
			"rawdata": ipres,
			"ip": ipres.ip,
			"hostname": ipres.hostname,
			"country": ipres.country,
			"region": process.env.AWS_REGION,
			"environment": process.env.AWS_EXECUTION_ENV,
			"memorysize": process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
		}
	}

  	// put the item into dynamodb
	await ddbclient.put(params).promise();

	seg.addAnnotation('urlpath', '/put');
	seg.addAnnotation('clientip', ipres.ip);
	seg.addAnnotation('timest', currenttime);

	seg.close();
	return "successful put " + currenttime;
};

// main lambda handler
const handler = async event => {

	console.log(event);

    // get the requested url path and dynamodb key value
	const reqpath = event.path;
	const apigwurl = event.requestContext.domainName;
	const ddbts = reqpath.split('/')[2];

	// create status, ddb record and cache status var
	var msg = "default get";
	let cache;
	let ddbrec = "empty";
	let httpreq;
	let puturl;

    // get current timestamp
    var now = new Date();
    var currenttime = now.getTime();

    // get node process lifetime to measure host uptime
    var up = Number(process.uptime().toFixed(0));
    var uptime = prettyms(up * 1000, {compact: true});

    // if the ipres value was not retrieved from cache
    if (ipres == '') {
                    
        // request the ip
		httpreq = await getURL(httpurl);

		// store ipinfo results in global variable
		ipres = httpreq;
		cache = "cold start";
        console.log("! " + cache + " - retrieved IP for "+ reqpath + " request");

    } else {

		// if ipres value was set, skip the ipinfo request
		cache = "warm start";
		console.log("* " + cache + " - cached ip result for " + reqpath +" request");

		// reuse the cached ipinfo results
		httpreq = ipres;
    }

    if (reqpath.startsWith("/put")) {

        // PUT request

        // put a record into dynamodb
		var x = await ddbput(uptime, currenttime, up);
		puturl = "https://" + apigwurl + "/get/" + currenttime + "/"
		ddbrec = x;
		console.log("PUT " + x);
		msg = "put ddb " + x + " " + uptime;


    } else if (reqpath.startsWith("/get")) {
        
		// GET request

		// if the ipres value was not retrieved from cache
		var x = await ddbget(ddbts);
		ddbrec = x;
		console.log("GET " + x);
		msg = "get " + uptime;

    } else if (reqpath.startsWith("/bootstrap")) {

        // BOOTSTRAP request to create 10 dummy records

        // create 10 ddb records with predictable timestamps (1 to 10)
        for (i = 0; i < 10; i++) {            
            ddbput(i, i, i);

        msg = "create 10 bootstrap records" + " - " + uptime + " " + ipres.ip;

        };
    };

    // construct response with status code and uptime
    const response = {
		statusCode: statusCode,
		body: httpreq,
		reqpath: reqpath,
		uptimestring: uptime,
		uptimeseconds: up,
		msg: msg,
		puturl: puturl,
		ddbrec: ddbrec,
		cache: cache
    };

	// return JSON in indented format
	return JSON.stringify(response, null, 2)
};

module.exports = { handler };
