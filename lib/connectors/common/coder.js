var Message = require('pomelo-protocol').Message;
var Constants = require('../../util/constants');
var logger = require('pomelo-logger').getLogger('pomelo', __filename);

var encode = function(reqId, route, msg) {
    if(!!reqId) {
        return composeResponse(this, reqId, route, msg);
    } else {
        return composePush(this, route, msg);
    }
};

function Swap(sandBox, i, j) {
    sandBox[i] = (sandBox[i] ^ sandBox[j]); // val1 XOR val2
    sandBox[j] = (sandBox[i] ^ sandBox[j]);
    sandBox[i] = (sandBox[i] ^ sandBox[j]);
}

function init(key) {
    var S = new Buffer(256);
    for (var i = 0; i < 256; i++) {
        S[i] = i;
    }

    var j = 0;

    for (var i = 0; i < 256; i++) {
        j = (j + S[i] + key[i % key.length]) % 256;
        Swap(S, i, j);
    }
    return S;
}

function genarate(input, S) {
    var i = 0, j = 0;
    // a mensagem original está armazenada na variável "input".
    var result = new Buffer(input.length);

    for (var k = 0; k < input.length; k++) {
        i = (i + 1) % 256;
        j = (j + S[i]) % 256;
        Swap(S, i, j);
        result[k] = (S[(S[i] + S[j]) % 256] ^ input[k]);
    }
    return result;
}


var staticSandBox = init(new Buffer([0x01 , 0x23, 0x45 , 0x67, 0x89, 0xab, 0xcd , 0xef]));


function copySandBox(){
    var sandBox = new Buffer(staticSandBox.length);
    staticSandBox.copy(sandBox,0,0,staticSandBox.length);
    return sandBox;
}

var decode = function(msg) {
    msg = Message.decode(msg.body);
    var route = msg.route;

    // decode use dictionary
    if(!!msg.compressRoute) {
        if(!!this.connector.useDict) {
            var abbrs = this.dictionary.getAbbrs();
            if(!abbrs[route]) {
                logger.error('dictionary error! no abbrs for route : %s', route);
                return null;
            }
            route = msg.route = abbrs[route];
        } else {
            logger.error('fail to uncompress route code for msg: %j, server not enable dictionary.', msg);
            return null;
        }
    }
    var sandBox = copySandBox();
    var decryped = genarate(msg.body, sandBox);
    // decode use protobuf
    if(!!this.protobuf && !!this.protobuf.getProtos().client[route]) {
        msg.body = this.protobuf.decode(route, decryped);
    } else if(!!this.decodeIO_protobuf && !!this.decodeIO_protobuf.check(Constants.RESERVED.CLIENT, route)) {
        msg.body = this.decodeIO_protobuf.decode(route, decryped);
    } else {
        msg.body = JSON.parse(decryped.toString('utf8'));
    }

    return msg;
};

var composeResponse = function(server, msgId, route, msgBody) {
    if(!msgId || !route || !msgBody) {
        return null;
    }
    msgBody = encodeBody(server, route, msgBody);
    var sandBox = copySandBox();
    var crypted = genarate(msgBody, sandBox);

    return Message.encode(msgId, Message.TYPE_RESPONSE, 0, null, crypted);
};

var composePush = function(server, route, msgBody) {
    if(!route || !msgBody){
        return null;
    }
    msgBody = encodeBody(server, route, msgBody);
    // encode use dictionary
    var compressRoute = 0;
    if(!!server.dictionary) {
        var dict = server.dictionary.getDict();
        if(!!server.connector.useDict && !!dict[route]) {
            route = dict[route];
            compressRoute = 1;
        }
    }
    var sandBox = copySandBox();
    var crypted = genarate(msgBody, sandBox);

    return Message.encode(0, Message.TYPE_PUSH, compressRoute, route, crypted);
};

var encodeBody = function(server, route, msgBody) {
    // encode use protobuf
    if(!!server.protobuf && !!server.protobuf.getProtos().server[route]) {
        msgBody = server.protobuf.encode(route, msgBody);
    } else if(!!server.decodeIO_protobuf && !!server.decodeIO_protobuf.check(Constants.RESERVED.SERVER, route)) {
        msgBody = server.decodeIO_protobuf.encode(route, msgBody);
    } else {
        msgBody = new Buffer(JSON.stringify(msgBody), 'utf8');
    }

    if(msgBody == null){
        logger.error('encodeBody msgBody is null', route);
        return new Buffer(JSON.stringify({}), 'utf8');
    }

    return msgBody;
};

module.exports = {
    encode: encode,
    decode: decode
};
