import { Bond, BondState } from '../interface/Bond';
import { BondAccessory } from '../platformAccessory';
import { BondPlatform } from '../platform';
import { Device } from '../interface/Device';
import { Observer } from '../Observer';
import { PlatformAccessory } from 'homebridge';
import { ButtonService, WindowCoveringService } from '../Services';

export class ShadesAccessory implements BondAccessory  {
  platform: BondPlatform
  accessory: PlatformAccessory
  // Slider mode (default)
  windowCoveringService?: WindowCoveringService
  // Switch mode (include_shade_switches)
  openService?: ButtonService
  closeService?: ButtonService
  stopService?: ButtonService
  // Optional extras (available in both modes)
  presetService?: ButtonService
  toggleStateService?: ButtonService

  constructor(
    platform: BondPlatform,
    accessory: PlatformAccessory,
    bond: Bond) {
    this.platform = platform;
    this.accessory = accessory;
    const device: Device = accessory.context.device;

    // When enabled, expose each shade as discrete Open / Close / Stop buttons
    // instead of a single position slider. See `include_shade_switches` in config.
    const useSwitches = platform.config.include_shade_switches === true;

    if (useSwitches) {
      // Drop the slider if it was created under a previous config so we don't
      // leave a stale WindowCovering tile behind on the accessory.
      const windowCovering = accessory.getService(platform.Service.WindowCovering);
      if (windowCovering) {
        accessory.removeService(windowCovering);
      }
      this.setupSwitches(bond, device);
    } else {
      // Drop any switches left over from a previous config.
      this.removeSwitch('ShadeOpen');
      this.removeSwitch('ShadeClose');
      this.removeSwitch('ShadeStop');
      this.windowCoveringService = new WindowCoveringService(platform, accessory);
    }

    if (platform.config.include_toggle_state) {
      this.toggleStateService = new ButtonService(platform, accessory, 'Toggle State', 'ToggleState');
    } else {
      this.removeService('Toggle State');
    }

    if (Device.MShasPreset(device)) {
      this.presetService = new ButtonService(platform, accessory, 'Preset', 'Preset');
    }

    this.observe(bond);
  }

  updateState(state: BondState) {
    const windowCovering = this.windowCoveringService;
    if (windowCovering) {
      // If position is available, use it, otherwise fall back to open state
      if (state.position !== undefined) {
        // Convert Bond's extended percentage (0=open, 100=closed) to HomeKit's open percentage (0=closed, 100=open)
        const homekitPosition = 100 - state.position;
        windowCovering.currentPosition.updateValue(homekitPosition);
        windowCovering.targetPosition.updateValue(homekitPosition);
      } else {
        windowCovering.currentPosition.updateValue(state.open === 1 ? 100 : 0);
        windowCovering.targetPosition.updateValue(state.open === 1 ? 100 : 0);
      }
    }
    // Switch mode buttons are stateless (they reset themselves), so there's
    // nothing to update here.
  }

  private observe(bond: Bond): void {
    const device: Device = this.accessory.context.device;

    this.observeWindowCovering(bond, device);
    this.observePreset(bond, device);
    this.observeToggleState(bond, device);
  }

  // Switch mode: one stateless button per action, controlled individually.
  private setupSwitches(bond: Bond, device: Device): void {
    if (Device.MShasOpen(device)) {
      this.openService = new ButtonService(this.platform, this.accessory, 'Open', 'ShadeOpen');
      Observer.set(this.openService.on, (_, callback) => {
        bond.api.open(device, callback)
          .then(() => {
            this.platform.debug(this.accessory, `${device.name}: Opening shade`);
          })
          .catch((error: string) => {
            this.platform.error(this.accessory, `Error opening shade: ${error}`);
          });
      });
    } else {
      this.removeSwitch('ShadeOpen');
      this.platform.error(this.accessory, 'Shade does not support the Open action; Open button not added.');
    }

    if (Device.MShasClose(device)) {
      this.closeService = new ButtonService(this.platform, this.accessory, 'Close', 'ShadeClose');
      Observer.set(this.closeService.on, (_, callback) => {
        bond.api.close(device, callback)
          .then(() => {
            this.platform.debug(this.accessory, `${device.name}: Closing shade`);
          })
          .catch((error: string) => {
            this.platform.error(this.accessory, `Error closing shade: ${error}`);
          });
      });
    } else {
      this.removeSwitch('ShadeClose');
      this.platform.error(this.accessory, 'Shade does not support the Close action; Close button not added.');
    }

    // Bond names the shade "stop" action `Hold`.
    if (Device.MShasStop(device)) {
      this.stopService = new ButtonService(this.platform, this.accessory, 'Stop', 'ShadeStop');
      Observer.set(this.stopService.on, (_, callback) => {
        bond.api.hold(device, callback)
          .then(() => {
            this.platform.debug(this.accessory, `${device.name}: Stopping shade`);
          })
          .catch((error: string) => {
            this.platform.error(this.accessory, `Error stopping shade: ${error}`);
          });
      });
    } else {
      this.removeSwitch('ShadeStop');
    }
  }

  private observeWindowCovering(bond: Bond, device: Device) {
    const windowCovering = this.windowCoveringService;
    if (!windowCovering) {
      return;
    }

    if (!Device.MShasToggle(device)) {
      this.platform.error(this.accessory, 'ShadesAccessory does not have required ToggleOpen action.');
      return;
    }

    // Set initial state
    bond.api.getState(device.id).then(state => {
      this.updateState(state);
    });

    const props = {
      minValue: 0,
      maxValue: 100,
      minStep: Device.MShasPosition(device) ? 1 : 100,
    };
    windowCovering.targetPosition.setProps(props);

    Observer.set(windowCovering.targetPosition, (value, callback) => {
      if (Device.MShasPosition(device)) {
        // Convert HomeKit's open percentage (0=closed, 100=open) to Bond's extended percentage (0=open, 100=closed)
        const bondPosition = 100 - (value as number);
        bond.api.setPosition(device, bondPosition, callback)
          .then(() => {
            this.platform.debug(this.accessory, `Set position: ${bondPosition} (HomeKit: ${value})`);
          })
          .catch((error: string) => {
            this.platform.error(this.accessory, `Error setting position: ${error}`);
          });
      } else {
        // Otherwise, toggle open/closed based on target position
        bond.api.toggleOpen(device, callback)
          .then(() => {
            this.platform.debug(this.accessory, `Toggled open: ${value}`);
          })
          .catch((error: string) => {
            this.platform.error(this.accessory, `Error toggling open: ${error}`);
          });
      }
    });
  }

  private observePreset(bond: Bond, device: Device) {
    if (!this.presetService) {
      return;
    }

    Observer.set(this.presetService.on, (_, callback) => {
      bond.api.preset(device, callback)
        .then(() => {
          this.platform.debug(this.accessory, 'Executed shade preset');
        })
        .catch((error: string) => {
          this.platform.error(this.accessory, `Error executing preset: ${error}`);
        });
    });
  }

  private observeToggleState(bond: Bond, device: Device) {
    if (!this.toggleStateService) {
      return;
    }

    Observer.set(this.toggleStateService.on, (_, callback) => {
      bond.api.toggleState(device, 'open', callback)
        .then(() => {
          this.platform.debug(this.accessory, `${device.name} open state toggled`);
        })
        .catch((error: string) => {
          this.platform.error(this.accessory, `Error toggling open state: ${error}`);
        });
    });
  }

  private removeService(serviceName: string) {
    const service = this.accessory.getService(serviceName);
    if (service) {
      this.accessory.removeService(service);
    }
  }

  private removeSwitch(subType: string) {
    const service = this.accessory.getServiceById(this.platform.Service.Switch, subType);
    if (service) {
      this.accessory.removeService(service);
    }
  }
}
