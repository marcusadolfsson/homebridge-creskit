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
            // Reconnect
            cresKitSocket.connect(this.config["port"], this.config["host"], function() {
                this.log('Re-Connected to Crestron Machine');
            }.bind(this));
        }.bind(this));

        // All Crestron replies goes via this connection
        cresKitSocket.on('data', function(data) {
            this.log("Raw Response : " + data);

            // Data comes from Creston Module (events, replies). This listener parses the information.
            // Events are used to trigger Status Callbacks, and to setValue on changes from the module
            var dataArray = data.toString().split("*"); // Commands terminated with *
            async.each(dataArray, function(response, callback) {
                var responseArray = response.toString().split(":");
                // responseArray[0] = lightbulbs : responseArray[1] = id : responseArray[2] = getPowerState : responseArray[3] = value

                if (responseArray[0]!="") {
                    eventEmitter.emit(responseArray[0] + ":" + responseArray[1] + ":" + responseArray[2], parseInt(responseArray[3])); // convert string to value
                    this.log("EMIT: " + responseArray[0] + ":" + responseArray[1] + ":" + responseArray[2] + " = " + responseArray[3]);
                }

                callback();

            }.bind(this), function(err) {
                //console.log("SockedRx Processed");
            });

        }.bind(this));

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

    setValue: function(level, callback) {
        callback( error, 0 );
    },
    getValue: function(callback) {
        callback( error, 0 );
    },
    //---------------
    // Lightbulb, Switch (Scenes)
    //---------------
    getPowerState: function(callback) { // this.config.type = Lightbulb, Switch
        cresKitSocket.write(this.config.type + ":" + this.id + ":getPowerState:*"); // (:* required)

        // Listen Once for value coming back
       eventEmitter.once(this.config.type + ":" + this.id + ":getPowerState", function(value) {
            try {
                callback( null, value);
            } catch (err) {
                this.log(err);
            }
        }.bind(this));
    },
    setPowerState: function(powerOn, callback) {
        if (powerOn) {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setPowerState:1*");
        } else {
            cresKitSocket.write(this.config.type + ":" + this.id + ":setPowerState:0*");
        }
        callback();
    },
    //---------------
    // Garage
    //---------------
    getCurrentDoorState: function(callback) {
        cresKitSocket.write("GarageDoorOpener:" + this.id + ":getCurrentDoorState:*"); // (:* required)
        //this.log("cresKitSocket.write getCurrentDoorState %s", this.id);

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
        cresKitSocket.write("GarageDoorOpener:" + this.id + ":setTargetDoorState:" + state + "*");
        callback();

    },
    getObstructionDetected: function(callback) {
        // Not yet support
        callback( null, 0 );
    },
    //---------------
    // Thermostat
    //---------------
    getTemperature: function(callback) {
        callback( null, 20 );
    },

    getThermostatCurrentHeatingCoolingState: function(callback) {

        /*
        stateOffValues callback( null, 0 );
        stateHeatValues callback( null, 1 );
        stateCoolValues callback( null, 2 );
        stateAutoValues callback( null, 3 );
        callback( null, 0 );
        */
        callback( null, Characteristic.CurrentHeatingCoolingState.COOL );

        //HEAT/AUTO/OFF
    },

    setThermostatCurrentHeatingCoolingState: function(state, callback) {

        /*
        stateOffValues callback( null, 0 );
        stateHeatValues callback( null, 1 );
        stateCoolValues callback( null, 2 );
        stateAutoValues callback( null, 3 );
        */

        callback();

    },

    getThermostatTargetHeatingCoolingState: function(callback) {

        /*
         stateOffValues callback( null, 0 );
         stateHeatValues callback( null, 1 );
         stateCoolValues callback( null, 2 );
         stateAutoValues callback( null, 3 );
         callback( null, 0 );
         */
        callback( null, Characteristic.TargetHeatingCoolingState.COOL );
    },

    setThermostatTargetHeatingCoolingState: function(state, callback) {

        /*
         stateOffValues callback( null, 0 );
         stateHeatValues callback( null, 1 );
         stateCoolValues callback( null, 2 );
         stateAutoValues callback( null, 3 );
         */

        callback();

    },

    getThermostatTargetTemperature: function(callback) {
        //if( this.config.temperatureUnit == "F" ) {
        //    value = (value-32)*5/9;
        //}
        callback( null, 20 );
    },

    setThermostatTargetTemperature: function(temperature, callback) {

        //if( this.config.temperatureUnit == "F" ) {
        //    temperature = temperature*9/5+32;
        //}

        callback();
    },

    getThermostatTemperatureDisplayUnits: function(callback) {
        if( this.config.temperatureUnit == "F" ) {
            callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
        } else {
            callback( null, Characteristic.TemperatureDisplayUnits.CELSIUS);
        }
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
        cresKitSocket.write("SecuritySystem:" + this.id + ":setSecuritySystemTargetState:" + state + "*");
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
                    CurrentDoorState.setValue(value); // also set target so the system knows we initiated it open/closed
                    TargetDoorState.setValue(value);
                }.bind(this));

                // Special Initilization to set Startup Values
                cresKitSocket.write("GarageDoorOpener:" + this.id + ":getCurrentDoorState:*"); // (:* required)
                eventEmitter.once("GarageDoorOpener:" + this.id + ":getCurrentDoorState", function(value) {
                    try {
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
                    SecuritySystemCurrentState.setValue(value);
                    SecuritySystemTargetState.setValue(value);
                }.bind(this));

                // Special Initilization to set Startup Values
                cresKitSocket.write("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState:*"); // (:* required)
                eventEmitter.once("SecuritySystem:" + this.id + ":getSecuritySystemCurrentState", function(value) {
                    try {
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
