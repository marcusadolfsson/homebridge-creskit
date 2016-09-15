/*
https://github.com/nfarina/homebridge-legacy-plugins/blob/master/platforms/HomeSeer.js used for reference.
*/

'use strict';

var async = require('async');
var request = require("request");
var net = require('net');
var events = require('events');
var Service, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerPlatform("homebridge-creskit", "CresKit", CresKit);
}

// TCP connection to Crestron Module
var cresKitSocket = new net.Socket();
var eventEmitter = new events.EventEmitter();

// fromEventCheck
// Events from Crestron to Homebridge should NOT repeat back to Crestron after updating Homebridge (as Crestron already knows the status).
// Store the event name/value in a global array, stop the cmd from sending if match.
var eventCheckData = [];
function fromEventCheck(what) {
    var found = eventCheckData.indexOf(what);
    var originalFound = found;
    while (found !== -1) { // Remove all references
        eventCheckData.splice(found, 1);
        found = eventCheckData.indexOf(what);
    }
    if (originalFound==-1) { // No match
        return false;
    } else {
        return true;
    }
}

function CresKit(log, config) {
    this.log = log;
    this.config = config;
}

CresKit.prototype = {
    accessories: function(callback) {
        var foundAccessories = [];

        // Build Device List
        this.log("Starting CresKit Config");

        cresKitSocket.connect(this.config["port"], this.config["host"], function() {
            this.log('Connected to Crestron Machine');
            // ERROR CONNECITON
        }.bind(this));

        cresKitSocket.on('close', function() {
            this.log('Connection closed');
            // Handle error properly
            // Reconnect
            cresKitSocket.connect(this.config["port"], this.config["host"], function() {
                this.log('Re-Connected to Crestron Machine');
            }.bind(this));
        }.bind(this));

        // All Crestron replies goes via this connection
        cresKitSocket.on('data', function(data) {
            //this.log("Raw Crestron Data : " + data);

            // Data from Creston Module. This listener parses the information and updates Homebridge
            // get* - replies from get* requests
            // event* - sent upon any changes on Crestron side (including in response to set* commands)
            var dataArray = data.toString().split("*"); // Commands terminated with *
            async.each(dataArray, function(response, callback) {
                var responseArray = response.toString().split(":");
                // responseArray[0] = (config.type ie lightbulbs) : responseArray[1] = (id) : responseArray[2] = (command ie getPowerState) : responseArray[3] = (value)

                if (responseArray[0]!="") {
                    eventEmitter.emit(responseArray[0] + ":" + responseArray[1] + ":" + responseArray[2], parseInt(responseArray[3])); // convert string to value
                    this.log("EMIT: " + responseArray[0] + ":" + responseArray[1] + ":" + responseArray[2] + " = " + responseArray[3]);
                }

                callback();

            }.bind(this), function(err) {
                //console.log("SockedRx Processed");
            });

        }.bind(this));

        // Accessories Configuration
        async.each(this.config.accessories, function(accessory, asynCallback) {

            var accessory = new CresKitAccessory( this.log, this.config, accessory);
            foundAccessories.push(accessory);

            return asynCallback();  //let async know we are done
        }.bind(this), function(err) {

            if(err) {
                this.log(err);
            } else {
                this.log("Success CresKit Config");
                callback(foundAccessories);
            }
        }.bind(this));

    }
}

function CresKitAccessory(log, platformConfig, accessoryConfig) {
    this.log = log;
    this.config = accessoryConfig;
    this.id = accessoryConfig.id;
    this.name = accessoryConfig.name
    this.model = "CresKit";
}

CresKitAccessory.prototype = {

    identify: function(callback) {
        callback();
    },
    //---------------
    // Lightbulb, Switch (Scenes)
    //---------------
    getPowerState: function(callback) { // this.config.type = Lightbulb, Switch
        cresKitSocket.write(this.config.type + ":" + this.id + ":getPowerState:*"); // (:* required) on get

        // Listen Once for value coming back, if it does trigger callback
       eventEmitter.once(this.config.type + ":" + this.id + ":getPowerState", function(value) {
            try {
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setPowerState: function(state, callback) {

        //Do NOT send cmd to Crestron when Homebridge was notified from an Event - Crestron already knows the state!
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventPowerState:" + state)==false) {

            if (state) {
                cresKitSocket.write(this.config.type + ":" + this.id + ":setPowerState:1*"); // (* after value required on set)
                //this.log("cresKitSocket.write - " + this.config.type + ":" + this.id + ":setPowerState:1*");
            } else {
                cresKitSocket.write(this.config.type + ":" + this.id + ":setPowerState:0*");
                //this.log("cresKitSocket.write - " + this.config.type + ":" + this.id + ":setPowerState:0*");
            }

        }

        callback();
    },
    //---------------
    // Garage
    //---------------
    getCurrentDoorState: function(callback) {
        cresKitSocket.write("GarageDoorOpener:" + this.id + ":getCurrentDoorState:*"); // (:* required)

        // Listen Once for value coming back. 0 open, 1 closed
        eventEmitter.once("GarageDoorOpener:" + this.id + ":getCurrentDoorState", function(value) {
            try {
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setTargetDoorState: function(state, callback) {
        //this.log("setTargetDoorState %s", state);
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventGarageDoorState:" + state)==false) {
            cresKitSocket.write("GarageDoorOpener:" + this.id + ":setTargetDoorState:" + state + "*");
        }
        callback();
    },
    getObstructionDetected: function(callback) {
        // Not yet support
        callback( null, 0 );
    },

    //---------------
    // Security System
    //---------------
    getSecuritySystemCurrentState: function(callback) {
        cresKitSocket.write("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState:*"); // (:* required)
        //armedStay=0 , armedAway=1, armedNight=2, disarmed=3, alarmValues = 4
        eventEmitter.once("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState", function(value) {
            try {
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setSecuritySystemTargetState: function(state, callback) {
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventSecuritySystemCurrentState:" + state)==false) {
            cresKitSocket.write("SecuritySystem:" + this.id + ":setSecuritySystemTargetState:" + state + "*");
        }
        callback();
    },

    //---------------
    // Setup Config
    //---------------
    getServices: function() {
        var services = []

        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, "CresKit")
            .setCharacteristic(Characteristic.Model, this.model )
            .setCharacteristic(Characteristic.SerialNumber, "CK " + this.config.type + " ID " + this.id);
        services.push( informationService );

        switch( this.config.type ) {
            case "Lightbulb": {
                var lightbulbService = new Service.Lightbulb();
                var On = lightbulbService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setPowerState.bind(this))
                    .on('get', this.getPowerState.bind(this));

                // Register a listener
                eventEmitter.on("Lightbulb:" + this.id + ":eventPowerState", function(value) {
                    eventCheckData.push("Lightbulb:" + this.id + ":eventPowerState:" + value);
                    On.setValue(value);
                }.bind(this));

                services.push( lightbulbService );
                break;
            }

            case "Switch": {
                var switchService = new Service.Switch();
                var On = switchService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setPowerState.bind(this))
                    .on('get', this.getPowerState.bind(this));

                // Register a listener for event changes
                eventEmitter.on("Switch:" + this.id + ":eventPowerState", function(value) {
                    eventCheckData.push("Switch:" + this.id + ":eventPowerState:" + value);
                    On.setValue(value);
                }.bind(this));

                services.push( switchService );
                break;
            }

            case "GarageDoorOpener": {
                var garageDoorOpenerService = new Service.GarageDoorOpener();
                var CurrentDoorState = garageDoorOpenerService
                    .getCharacteristic(Characteristic.CurrentDoorState)
                    .on('get', this.getCurrentDoorState.bind(this));
                var TargetDoorState = garageDoorOpenerService
                    .getCharacteristic(Characteristic.TargetDoorState)
                    .on('set', this.setTargetDoorState.bind(this));
                garageDoorOpenerService
                    .getCharacteristic(Characteristic.ObstructionDetected)
                    .on('get', this.getObstructionDetected.bind(this));

                // Register a listener for event changes
                eventEmitter.on("GarageDoorOpener:" + this.id + ":eventGarageDoorState", function(value) {
                    eventCheckData.push("GarageDoorOpener:" + this.id + ":eventGarageDoorState:" + value);
                    CurrentDoorState.setValue(value); // also set target so the system knows we initiated it open/closed
                    TargetDoorState.setValue(value);
                }.bind(this));

                // One-Time Initilization for Startup Values
                cresKitSocket.write("GarageDoorOpener:" + this.id + ":getCurrentDoorState:*"); // (:* required)
                eventEmitter.once("GarageDoorOpener:" + this.id + ":getCurrentDoorState", function(value) {
                    try {
                        eventCheckData.push("GarageDoorOpener:" + this.id + ":eventGarageDoorState:" + value); // Treat response as an event (so it doesn't send)
                        CurrentDoorState.setValue(value);
                        TargetDoorState.setValue(value);
                    } catch (err) {
                        this.log(err);
                    }
                }.bind(this));

                services.push( garageDoorOpenerService );
                break;
            }

            case "SecuritySystem": {
                var securitySystemService = new Service.SecuritySystem();
                var SecuritySystemCurrentState = securitySystemService
                    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                    .on('get', this.getSecuritySystemCurrentState.bind(this));
                var SecuritySystemTargetState = securitySystemService
                    .getCharacteristic(Characteristic.SecuritySystemTargetState)
                    .on('set', this.setSecuritySystemTargetState.bind(this));

                // Register a listener for event changes
                eventEmitter.on("SecuritySystem:" + this.id + ":eventSecuritySystemCurrentState", function(value) {
                    eventCheckData.push("SecuritySystem:" + this.id + ":eventSecuritySystemCurrentState:" + value);
                    SecuritySystemCurrentState.setValue(value);
                    SecuritySystemTargetState.setValue(value);
                }.bind(this));

                // Special Initilization to set Startup Values
                cresKitSocket.write("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState:*"); // (:* required)
                eventEmitter.once("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState", function(value) {
                    try {
                        eventCheckData.push("SecuritySystem:" + this.id + ":eventSecuritySystemCurrentState:" + value); // Treat response as an event (so it doesn't send)
                        SecuritySystemCurrentState.setValue(value);
                        SecuritySystemTargetState.setValue(value);
                    } catch (err) {
                        this.log(err);
                    }
                }.bind(this));


                services.push( securitySystemService );
                break;
            }

        }

        return services;
    }
}
