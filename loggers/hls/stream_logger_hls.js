//LOG COLLECTOR FOR HLS
//Collect global data for a stream generated by HLS clients
//AND
//infos on single HLS clients connected

//NB: nginx MUST have the default access log format ('combined')

var http = require('http')
, fs = require('fs')
, template = require('url-template')
, LineByLineReader = require('line-by-line')
, Useragent = require('useragent')

//list of streams to log / set to [] to fetch all
var stream_list = []

//logger url
var logger_server = {
  host: '94.23.55.74',
  port: 3000,
  url: '/Stream/Update'
}

//in this file we put the timestamp of the last log analysis
var timestamp_file = '/tmp/hls_log_timestamp.txt'

var log_file = '/var/log/nginx/access.log'

var last_timestamp = 0
fs.readFile(timestamp_file,'utf8',function(err,data){

  //check last log analysis timestamp
  if (!!err) {
    // console.log('Error reading from timestamp file: '+err)
  }
  else{
    if (!!parseInt(data)) last_timestamp = parseInt(data)
  }

  var clients_list = []
  var streams_list = []
  
  var lr = new LineByLineReader(log_file);

  lr.on('error', function (err) {
      console.log('Error reading from log file: '+err)
  });

  lr.on('line', function (line) {
     

      var date_exp = /\[(.*)\]/g
      var date = date_exp.exec(line)[1]
      if (!!date){
        //check if the line has already been parsed in the past
        timestamp = timestampFromDate(date)

        if (timestamp>last_timestamp){

          //check if the stream 
          var stream_reg = /GET.*\/(.*)-[0-9]*\./g
          if (stream_reg.test(line)){

            var stream_reg = /(.*)\s-(.*)\s-\s\[(.*)\]\s"GET\s(.*\..*)\sH.*"\s([0-9]*).*\s([0-9]*)\s".*"\s"(.*)"/g
            var params = stream_reg.exec(line)
            if (!!params){
              var ip = params[1]
              var url = params[4]

              var name_reg = /.*\/(.*)-[0-9]+.*/g
              var streamname = name_reg.exec(url)

              url = url.replace(/-[0-9]*/g,'')

              if (!!streamname) streamname = streamname[1]

              var httpcode = params[5]
              var bytes = params[6]
              var useragent = params[7]

              //check if the http code is OK
              if (((httpcode=='200') || (httpcode=='206')) && ((stream_list.indexOf(streamname)!=-1) || (!stream_list.length))) {
                var clientid = jenkins_hash(ip+useragent,99999)

                // var os_reg = /;\s([^\)]+)/g
                // var os = os_reg.exec(useragent)
                
                var agent = Useragent.parse(useragent);
                var os = agent.os.family
                var browser = agent.family

                //update client data
                if (!clients_list[clientid]) clients_list[clientid] = {}
                clients_list[clientid].os = os
                clients_list[clientid].url = url
                clients_list[clientid].browser = browser
                clients_list[clientid].id = clientid
                clients_list[clientid].timestamp = timestamp


                //update stream data
                if (!streams_list[streamname]) streams_list[streamname] = {
                  dataout: 0,
                  clients_id: [],
                  clients: [],
                  name: '',
                  timestamp: 0
                }
                streams_list[streamname].dataout += parseInt(bytes)
                streams_list[streamname].name = streamname
                streams_list[streamname].timestamp = last_timestamp
                if (streams_list[streamname].clients_id.indexOf(clientid)==-1) 
                  streams_list[streamname].clients_id.push(clientid)


              }
            }

              


          }
          
        }

      }
  });

  lr.on('end', function () {
      //build the data object
      var streams = []
      for (var stream in streams_list){
        var clients_id = streams_list[stream].clients_id
        for (var i = 0; i < clients_id.length; i++) {
          streams_list[stream].clients.push(clients_list[clients_id[i]])
        };
        streams.push(streams_list[stream])
      }
      
      for (var i = 0; i < streams.length; i++) {

        //send to the logger
        var clientstring = JSON.stringify({clients:  streams[i].clients});

        var headers = {
          'Content-Type': 'application/json',
          'Content-Length': clientstring.length
        };

        var params = {
          path : '?dataout='+streams[i].dataout+'&name='+streams[i].name+'&timestamp='+streams[i].timestamp,
          headers: headers
        }
        params.host = logger_server.host
        params.path = logger_server.url+params.path
        params.port = logger_server.port

        var request = http.request(params)
        request.on('error', function(err){console.log("HTTP error: "+err)})
        request.write(clientstring)
        request.end()
      };

      //update timestamp on file
      fs.writeFile(timestamp_file,timestamp,function(err){
        if (!!err){
          console.log('Error writing to timestamp file: '+err)
        }
      })

      

  });


})

var timestampFromDate = function(date){
  date = date.replace(':',' ')
  return +(new Date(date))
}
var jenkins_hash = function(key, interval_size) {
   var hash = 0;
   for (var i=0; i<key.length; ++i) {
      hash += key.charCodeAt(i);
      hash += (hash << 10);
      hash ^= (hash >> 6);
   }
   hash += (hash << 3);
   hash ^= (hash >> 11);
   hash += (hash << 15);
   // make unsigned and modulo interval_size
   return (hash >>> 0) % interval_size;
}
