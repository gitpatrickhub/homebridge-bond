import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';

import { BondPlatform } from './platform';
import { BondConfig, Device, Action } from './interface/bond';
import { Bond } from './bond';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BondAccessory {
  private service?: Service;
  private device: Device;
  private bond: Bond;

  constructor(
    private readonly platform: BondPlatform,
    private readonly accessory: PlatformAccessory,
    bond: Bond,
  ) {
    this.device = accessory.context.device;
    this.bond = bond;

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Olibra')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.id);

    // Ceiling Fan
    if (this.device.type === Device.Type.CF) {
      // get the LightBulb service if it exists, otherwise create a new LightBulb service
      // you can create multiple services for each accessory
      const lightService =
        this.accessory.getService(this.platform.Service.Lightbulb) ||
        this.accessory.addService(this.platform.Service.Lightbulb);

      // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
      // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
      // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

      // set the service name, this is what is displayed as the default name on the Home app
      // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
      lightService.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

      // register handlers for the On/Off Characteristic
      lightService
        .getCharacteristic(this.platform.Characteristic.On)
        .on('set', this.setLightOn.bind(this)) // SET - bind to the `setOn` method below
        .on('get', this.getLightOn.bind(this)); // GET - bind to the `getOn` method below

      if (this.device.properties.up_light && this.device.properties.down_light) {
        const upLightService =
          this.accessory.getService('Up Light') ||
          this.accessory.addService(this.platform.Service.Lightbulb, 'Up Light', 'up-light');
        upLightService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Up Light`);

        upLightService
          .getCharacteristic(this.platform.Characteristic.On)
          .on('set', this.setUpLightOn.bind(this))
          .on('get', this.getUpLightOn.bind(this));

        const downLightService =
          this.accessory.getService('Down Light') ||
          this.accessory.addService(this.platform.Service.Lightbulb, 'Down Light', 'down-light');
        downLightService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Down Light`);

        downLightService
          .getCharacteristic(this.platform.Characteristic.On)
          .on('set', this.setDownLightOn.bind(this))
          .on('get', this.getDownLightOn.bind(this));
      }

      // Fan Speed
      this.service =
        this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);

      this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

      // register handlers for the On/Off Characteristic
      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .on('set', this.setOn.bind(this))
        .on('get', this.getOn.bind(this));

      this.service
        .getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .on('set', this.setRotationSpeed.bind(this))
        .on('get', this.getRotationSpeed.bind(this));
    }

    // Fireplace
    if (this.device.type === Device.Type.FP) {
      this.service =
        this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

      this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .on('set', this.setFlameOn.bind(this))
        .on('get', this.getFlameOn.bind(this));
    }

    // Generic Device
    if (this.device.type === Device.Type.GX) {
      this.service =
        this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

      this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

      this.service
        .getCharacteristic(this.platform.Characteristic.On)
        .on('set', this.setPowerOn.bind(this))
        .on('get', this.getPowerOn.bind(this));
    }

    // Motorized Shades - WITH OPEN/CLOSE/STOP SWITCHES
    if (this.device.type === Device.Type.MS) {
      // Main Window Covering Service
      this.service =
        this.accessory.getService(this.platform.Service.WindowCovering) ||
        this.accessory.addService(this.platform.Service.WindowCovering);

      this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentPosition)
        .on('get', this.getCurrentPosition.bind(this));

      this.service
        .getCharacteristic(this.platform.Characteristic.TargetPosition)
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));

      this.service
        .getCharacteristic(this.platform.Characteristic.PositionState)
        .on('get', this.getPositionState.bind(this));

      // Add Open Switch
      const openSwitch =
        this.accessory.getService(`${this.device.name} Open`) ||
        this.accessory.addService(this.platform.Service.Switch, `${this.device.name} Open`, 'open');

      openSwitch
        .getCharacteristic(this.platform.Characteristic.On)
        .on('get', (callback) => callback(null, false))
        .on('set', async (value, callback) => {
          if (value as boolean) {
            try {
              await this.bond.api.executeAction(this.device.id, Action.Open);
              this.platform.log.info(`${this.device.name}: Opening shade`);
              // Auto-turn off the switch after triggering
              setTimeout(() => {
                openSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
              }, 500);
              callback(null);
            } catch (error) {
              this.platform.log.error(`${this.device.name}: Error opening shade:`, error);
              callback(error as Error);
            }
          } else {
            callback(null);
          }
        });

      // Add Close Switch
      const closeSwitch =
        this.accessory.getService(`${this.device.name} Close`) ||
        this.accessory.addService(this.platform.Service.Switch, `${this.device.name} Close`, 'close');

      closeSwitch
        .getCharacteristic(this.platform.Characteristic.On)
        .on('get', (callback) => callback(null, false))
        .on('set', async (value, callback) => {
          if (value as boolean) {
            try {
              await this.bond.api.executeAction(this.device.id, Action.Close);
              this.platform.log.info(`${this.device.name}: Closing shade`);
              // Auto-turn off the switch after triggering
              setTimeout(() => {
                closeSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
              }, 500);
              callback(null);
            } catch (error) {
              this.platform.log.error(`${this.device.name}: Error closing shade:`, error);
              callback(error as Error);
            }
          } else {
            callback(null);
          }
        });

      // Add Stop/Hold Switch (if device supports it)
      if (this.device.actions && this.device.actions.includes(Action.Hold)) {
        const stopSwitch =
          this.accessory.getService(`${this.device.name} Stop`) ||
          this.accessory.addService(this.platform.Service.Switch, `${this.device.name} Stop`, 'stop');

        stopSwitch
          .getCharacteristic(this.platform.Characteristic.On)
          .on('get', (callback) => callback(null, false))
          .on('set', async (value, callback) => {
            if (value as boolean) {
              try {
                await this.bond.api.executeAction(this.device.id, Action.Hold);
                this.platform.log.info(`${this.device.name}: Stopping shade`);
                // Auto-turn off the switch after triggering
                setTimeout(() => {
                  stopSwitch.updateCharacteristic(this.platform.Characteristic.On, false);
                }, 500);
                callback(null);
              } catch (error) {
                this.platform.log.error(`${this.device.name}: Error stopping shade:`, error);
                callback(error as Error);
              }
            } else {
              callback(null);
            }
          });
      }
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic On for ${this.device.name} -> ${on}`);

    try {
      if (on && this.device.properties.max_speed && this.device.properties.max_speed > 1) {
        await this.bond.api.executeAction(this.device.id, Action.SetSpeed, this.device.properties.max_speed);
      } else if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.power === 1 && state.speed && state.speed > 0;
      this.platform.log.debug(`Get Characteristic On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  async setRotationSpeed(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const speed = value as number;
    this.platform.log.debug(`Set Characteristic RotationSpeed for ${this.device.name} -> ${speed}`);

    const bondSpeed = Math.ceil((speed / 100) * this.device.properties.max_speed);
    this.platform.log.debug(`Converted to Bond Speed -> ${bondSpeed}`);

    try {
      if (speed === 0) {
        await this.bond.api.executeAction(this.device.id, Action.TurnOff);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.SetSpeed, bondSpeed);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getRotationSpeed(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const speed = Math.floor(((state.speed || 0) / this.device.properties.max_speed) * 100);
      this.platform.log.debug(`Get Characteristic RotationSpeed for ${this.device.name} -> ${speed}`);

      callback(null, speed);
    } catch {
      callback(new Error());
    }
  }

  async setLightOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic Light On for ${this.device.name} -> ${on}`);

    try {
      if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnLightOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnLightOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getLightOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.light === 1;
      this.platform.log.debug(`Get Characteristic Light On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  async setUpLightOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic Up Light On for ${this.device.name} -> ${on}`);

    try {
      if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnUpLightOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnUpLightOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getUpLightOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.up_light === 1;
      this.platform.log.debug(`Get Characteristic Up Light On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  async setDownLightOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic Down Light On for ${this.device.name} -> ${on}`);

    try {
      if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnDownLightOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnDownLightOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getDownLightOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.down_light === 1;
      this.platform.log.debug(`Get Characteristic Down Light On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  async setFlameOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic Flame On for ${this.device.name} -> ${on}`);

    try {
      if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnFpFanOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getFlameOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.power === 1;
      this.platform.log.debug(`Get Characteristic Flame On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  async setPowerOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const on = value as boolean;
    this.platform.log.debug(`Set Characteristic Power On for ${this.device.name} -> ${on}`);

    try {
      if (on) {
        await this.bond.api.executeAction(this.device.id, Action.TurnOn);
      } else {
        await this.bond.api.executeAction(this.device.id, Action.TurnOff);
      }
      callback(null);
    } catch {
      callback(new Error());
    }
  }

  async getPowerOn(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const on = state.power === 1;
      this.platform.log.debug(`Get Characteristic Power On for ${this.device.name} -> ${on}`);

      callback(null, on);
    } catch {
      callback(new Error());
    }
  }

  // Shade Position Methods
  private async getCurrentPosition(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const position = state.open === 1 ? 100 : 0;
      this.platform.log.debug(`${this.device.name}: CurrentPosition -> ${position}`);
      callback(null, position);
    } catch (error) {
      this.platform.log.error(`${this.device.name}: Error getting position:`, error);
      callback(error as Error);
    }
  }

  private async getTargetPosition(callback: CharacteristicSetCallback) {
    try {
      const state = await this.bond.api.getState(this.device.id);
      const position = state.open === 1 ? 100 : 0;
      this.platform.log.debug(`${this.device.name}: TargetPosition -> ${position}`);
      callback(null, position);
    } catch (error) {
      this.platform.log.error(`${this.device.name}: Error getting target position:`, error);
      callback(error as Error);
    }
  }

  private async setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const position = value as number;
    this.platform.log.debug(`${this.device.name}: Set TargetPosition -> ${position}`);

    try {
      if (position === 0) {
        await this.bond.api.executeAction(this.device.id, Action.Close);
      } else if (position === 100) {
        await this.bond.api.executeAction(this.device.id, Action.Open);
      } else {
        // For partial positions, default based on target
        // User will use Stop switch via Siri Shortcut for precise control
        if (position > 50) {
          await this.bond.api.executeAction(this.device.id, Action.Open);
        } else {
          await this.bond.api.executeAction(this.device.id, Action.Close);
        }
      }
      callback(null);
    } catch (error) {
      this.platform.log.error(`${this.device.name}: Error setting position:`, error);
      callback(error as Error);
    }
  }

  private getPositionState(callback: CharacteristicSetCallback) {
    // Always return STOPPED since we can't track movement without position feedback
    callback(null, this.platform.Characteristic.PositionState.STOPPED);
  }
}