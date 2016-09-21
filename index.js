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

var openGetStatus = []; // Sometimes a getStatus does not come back. We need to re-try for the app to be responsive.
function closeGetStatus(what) {
    var found = openGetStatus.indexOf(what);
    openGetStatus.splice(found, 1);

    console.log(openGetStatus);
}

// Resend unclosed GetStatus
function retryGetStatus() {
    async.each(openGetStatus, function (writeString, callback) {
        try {
            cresKitSocket.write(writeString);
            console.log("RETRY: " + writeString);
        } catch (err) {
            console.log(err);
        }
        callback();
    }.bind(this), function (err) {
        //console.log("retryGetStatus complete");
    });
}
setInterval(function() { retryGetStatus(); }, 2000);

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
            try {
                cresKitSocket.connect(this.config["port"], this.config["host"], function() {
                    this.log('Re-Connected to Crestron Machine');
                }.bind(this));
            } catch (err) {
                this.log(err);
            }


        }.bind(this));

        // All Crestron replies goes via this connection
        cresKitSocket.on('data', function(data) {
            this.log("Raw Crestron Data : " + data);

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
    // PowerState - Lightbulb, Switch, SingleSpeedFan (Scenes)
    //---------------
    getPowerState: function(callback) { // this.config.type = Lightbulb, Switch, etc
        cresKitSocket.write(this.config.type + ":" + this.id + ":getPowerState:*"); // (:* required) on get
        openGetStatus.push(this.config.type + ":" + this.id + ":getPowerState:*");
        //this.log("cresKitSocket.write - " + this.config.type + ":" + this.id + ":getPowerState:*");

        // Listen Once for value coming back, if it does trigger callback
        eventEmitter.once(this.config.type + ":" + this.id + ":getPowerState", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getPowerState:*");
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setPowerState: function(value, callback) {
        //Do NOT send cmd to Crestron when Homebridge was notified from an Event - Crestron already knows the state!
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventPowerState:" + value)==false) {
            if (value) {
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
        cresKitSocket.write(this.config.type + ":" + this.id + ":getCurrentDoorState:*"); // (:* required)
        openGetStatus.push(this.config.type + ":" + this.id + ":getCurrentDoorState:*");

        // Listen Once for value coming back. 0 open, 1 closed
        eventEmitter.once(this.config.type + ":" + this.id + ":getCurrentDoorState", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getCurrentDoorState:*");

                // Update TargetDoorState via event event
                eventEmitter.emit(this.config.type + ":" + this.id + ":eventCurrentDoorState", value);

                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setTargetDoorState: function(value, callback) {
        //this.log("setTargetDoorState %s", value);
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventCurrentDoorState:" + value)==false) {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setTargetDoorState:" + value + "*");
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
        cresKitSocket.write(this.config.type + ":" + this.id + ":getSecuritySystemCurrentState:*"); // (:* required)
        openGetStatus.push(this.config.type + ":" + this.id + ":getSecuritySystemCurrentState:*");

        //armedStay=0 , armedAway=1, armedNight=2, disarmed=3, alarmValues = 4
        eventEmitter.once(this.config.type + ":" + this.id + ":getSecuritySystemCurrentState", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getSecuritySystemCurrentState:*");

                // Update securitySystemTargetState via event event
                eventEmitter.emit(this.config.type + ":" + this.id + ":eventSecuritySystemCurrentState", value);

                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setSecuritySystemTargetState: function(value, callback) {
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventSecuritySystemCurrentState:" + value)==false) {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setSecuritySystemTargetState:" + value + "*");
        }
        callback();
    },
    //---------------
    // Binary Sensor
    //---------------
    getBinarySensorState: function(callback) {
        cresKitSocket.write(this.config.type + ":" + this.id + ":getBinarySensorState:*"); // (:* required)
        openGetStatus.push(this.config.type + ":" + this.id + ":getBinarySensorState:*");

        // Listen Once for value coming back. 0 open, 1 closed
        eventEmitter.once(this.config.type + ":" + this.id + ":getBinarySensorState", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getBinarySensorState:*");
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    //---------------
    // Lock (or any event that you needs push notifications)
    //---------------
    getLockCurrentState: function(callback) {
        //UNSECURED = 0;, SECURED = 1; .JAMMED = 2; UNKNOWN = 3;

        cresKitSocket.write(this.config.type + ":" + this.id + ":getLockCurrentState:*"); // (:* required)
        openGetStatus.push(this.config.type + ":" + this.id + ":getLockCurrentState:*");

        // Listen Once for value coming back. 0 open, 1 closed
        eventEmitter.once(this.config.type + ":" + this.id + ":getLockCurrentState", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getLockCurrentState:*");

                // Update setLockTargetState via event event
                eventEmitter.emit(this.config.type + ":" + this.id + ":eventLockCurrentState", value);

                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setLockTargetState: function(value, callback) {
        //UNSECURED = 0;, SECURED = 1;
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventLockCurrentState:" + value)==false) {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setLockTargetState:" + value + "*");
        }
        callback();

    },
    //---------------
    // MultiSpeedFan
    //---------------
    getRotationSpeed: function(callback) {
        cresKitSocket.write(this.config.type + ":" + this.id + ":getRotationSpeed:*"); // (:* required) on get
        openGetStatus.push(this.config.type + ":" + this.id + ":getRotationSpeed:*");

        // Listen Once for value coming back, if it does trigger callback
        eventEmitter.once(this.config.type + ":" + this.id + ":getRotationSpeed", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getRotationSpeed:*");

                // Update PowerState via event event
                eventEmitter.emit(this.config.type + ":" + this.id + ":eventRotationSpeed", value);

                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setRotationSpeed: function(value, callback) {

        //Do NOT send cmd to Crestron when Homebridge was recently notified from an Event - Crestron already knows the state!
        if (fromEventCheck(this.config.type + ":" + this.id + ":eventRotationSpeed:" + value)==false) {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setRotationSpeed:" + value + "*"); // (* after value required on set)
            this.log("cresKitSocket.write("+this.config.type + ":" + this.id + ":setRotationSpeed:" + value + "*");
        }

        callback();
    },
    setRotationState: function(value, callback) {

        if (fromEventCheck(this.config.type + ":" + this.id + ":eventRotationState:" + value)==false) {
            if (value == 0) {
                cresKitSocket.write(this.config.type + ":" + this.id + ":setRotationSpeed:0*");
                this.log("cresKitSocket.write("+this.config.type + ":" + this.id + ":setRotationSpeed:0*");
            }
            if (value == 1) {
                cresKitSocket.write(this.config.type + ":" + this.id + ":setRotationSpeed:999*"); //999 = 100 if off, otherwise leave current
                this.log("cresKitSocket.write("+this.config.type + ":" + this.id + ":setRotationSpeed:999*");
            }
        }

        callback();
    },
    //---------------
    // getValue/setValue Window Covering
    //---------------
    getCurrentPosition: function(callback) {
        callback( null, 100);

        //cresKitSocket.write(this.config.type + ":" + this.id + ":getCurrentPosition:*"); // (:* required)
        //openGetStatus.push(this.config.type + ":" + this.id + ":getCurrentPosition:*");

        eventEmitter.once(this.config.type + ":" + this.id + ":getCurrentPosition", function(value) {
            try {
                closeGetStatus(this.config.type + ":" + this.id + ":getCurrentPosition:*");

                eventEmitter.emit(this.config.type + ":" + this.id + ":eventCurrentPosition", value);

                //callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setTargetPosition: function(value, callback) {

        if (fromEventCheck(this.config.type + ":" + this.id + ":setTargetPosition:" + value)==false) {

            if (value==0) { //closed
                cresKitSocket.write(this.config.type + ":" + this.id + ":setTargetPosition:0*");
            } else { //any thing else open for now
                cresKitSocket.write(this.config.type + ":" + this.id + ":setTargetPosition:1*");
            }


        }
        callback();

    },
    getPositionState: function(callback) {
        callback( null, 2 );  // Temporarily return STOPPED
    },
    //---------------
    // Characteristic Config
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
                var PowerState = lightbulbService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setPowerState.bind(this))
                    .on('get', this.getPowerState.bind(this));

                // Register a listener
                eventEmitter.on(this.config.type + ":" + this.id + ":eventPowerState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventPowerState:" + value);
                    PowerState.setValue(value);
                }.bind(this));

                services.push( lightbulbService );
                break;
            }

            case "Switch": {
                var switchService = new Service.Switch();
                var PowerState = switchService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setPowerState.bind(this))
                    .on('get', this.getPowerState.bind(this));

                // Register a listener for event changes
                eventEmitter.on(this.config.type + ":" + this.id + ":eventPowerState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventPowerState:" + value);
                    PowerState.setValue(value);
                }.bind(this));

                services.push( switchService );
                break;
            }

            case "ContactSensor": {
                var contactSensorService = new Service.ContactSensor();
                var BinarySensorState = contactSensorService
                    .getCharacteristic(Characteristic.ContactSensorState)
                    .on('get', this.getBinarySensorState.bind(this));

                // Register a listener for event changes
                eventEmitter.on(this.config.type + ":" + this.id + ":eventBinarySensorState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventBinarySensorState:" + value);
                    BinarySensorState.setValue(value);
                }.bind(this));

                services.push( contactSensorService );
                break;
            }

            case "Lock": {
                var lockService = new Service.LockMechanism();
                var LockCurrentState = lockService
                    .getCharacteristic(Characteristic.LockCurrentState)
                    .on('get', this.getLockCurrentState.bind(this));
                var LockTargetState = lockService
                    .getCharacteristic(Characteristic.LockTargetState)
                    .on('set', this.setLockTargetState.bind(this));

                // Register a listener for event changes
                eventEmitter.on(this.config.type + ":" + this.id + ":eventLockCurrentState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventLockCurrentState:" + value);
                    LockCurrentState.setValue(value);
                    LockTargetState.setValue(value)
                }.bind(this));

                services.push( lockService );
                break;
            }

            case "SingleSpeedFan": {
                var fanService = new Service.Fan();
                var PowerState = fanService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setPowerState.bind(this))
                    .on('get', this.getPowerState.bind(this));

                // Register a listener for event changes
                eventEmitter.on(this.config.type + ":" + this.id + ":eventPowerState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventPowerState:" + value);
                    PowerState.setValue(value);
                }.bind(this));

                services.push( fanService );
                break;
            }

            case "MultiSpeedFan": {
                var fanService = new Service.Fan();

                var RotationState = fanService
                    .getCharacteristic(Characteristic.On)
                    .on('set', this.setRotationState.bind(this)); // requied for turning off when not using slider interface

                var RotationSpeed = fanService
                    .getCharacteristic(Characteristic.RotationSpeed)
                    .on("set", this.setRotationSpeed.bind(this))
                    .on("get", this.getRotationSpeed.bind(this));

                eventEmitter.on(this.config.type + ":" + this.id + ":eventRotationSpeed", function(value) {

                    var power_value;
                    if (value == 0) {
                        power_value = 0;
                    } else {
                        power_value = 1;
                    }

                    //this.log("FAN DEBUG " + this.config.type + ":" + this.id + ":eventRotationSpeed " + value + " " + power_value);

                    eventCheckData.push(this.config.type + ":" + this.id + ":eventRotationSpeed:" + value);
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventRotationState:" + power_value);
                    RotationSpeed.setValue(value);
                    RotationState.setValue(power_value);

                }.bind(this));

                services.push( fanService );
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
                eventEmitter.on(this.config.type + ":" + this.id + ":eventCurrentDoorState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventCurrentDoorState:" + value);
                    CurrentDoorState.setValue(value); // also set target so the system knows we initiated it open/closed
                    TargetDoorState.setValue(value);
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
                eventEmitter.on(this.config.type + ":" + this.id + ":eventSecuritySystemCurrentState", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventSecuritySystemCurrentState:" + value);
                    SecuritySystemCurrentState.setValue(value);
                    SecuritySystemTargetState.setValue(value);
                }.bind(this));

                services.push( securitySystemService );
                break;
            }

            case "WindowCovering": {
                var windowCoveringService = new Service.WindowCovering();
                var CurrentPosition = windowCoveringService
                    .getCharacteristic(Characteristic.CurrentPosition)
                    .on('get', this.getCurrentPosition.bind(this));
                var TargetPosition = windowCoveringService
                    .getCharacteristic(Characteristic.TargetPosition)
                    .on('set', this.setTargetPosition.bind(this));
                var PositionState = windowCoveringService
                    .getCharacteristic(Characteristic.PositionState)
                    .on('get', this.getPositionState.bind(this));


                // Register a listener for event changes
                eventEmitter.on(this.config.type + ":" + this.id + ":eventCurrentPosition", function(value) {
                    eventCheckData.push(this.config.type + ":" + this.id + ":eventCurrentPosition:" + value);
                    CurrentPosition.setValue(value);
                    TargetPosition.setValue(value);
                }.bind(this));


                services.push( windowCoveringService );

                break;
            }

        }

        return services;
    }
}
