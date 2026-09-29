import { describe, expect, it } from "vitest";
import {
  pauseCommand,
  requestControlCommand,
  resetCommand,
  simulationCommand,
  spinDownCommand,
  startCommand,
  stopCommand,
  targetCadenceCommand,
  targetPowerCommand,
  targetResistanceCommand,
} from "../src/raw.js";
import { FtmsRangeError } from "../src/errors.js";
import type { SpinDownControl } from "../src/types.js";

describe("FTMS command encoding", () => {
  it("preserves the literal lifecycle and spin-down packets", () => {
    expect([...requestControlCommand()]).toEqual([0]);
    expect([...resetCommand()]).toEqual([1]);
    expect([...startCommand()]).toEqual([7]);
    expect([...stopCommand()]).toEqual([8, 1]);
    expect([...pauseCommand()]).toEqual([8, 2]);
    expect([...spinDownCommand("start")]).toEqual([19, 1]);
    expect([...spinDownCommand("ignore")]).toEqual([19, 2]);
  });

  it("preserves Open Trainer rounding, including negative half steps", () => {
    expect([...targetPowerCommand(200.5)]).toEqual([5, 201, 0]);
    expect([...targetPowerCommand(-20.5)]).toEqual([5, 236, 255]);
    expect([...targetPowerCommand(-0.5)]).toEqual([5, 0, 0]);
    expect([...targetResistanceCommand(1.25)]).toEqual([4, 13, 0]);
    expect([...targetResistanceCommand(-1.25)]).toEqual([4, 244, 255]);
    expect([...targetResistanceCommand(1.25, "uint8")]).toEqual([4, 13]);
    expect([
      ...simulationCommand({
        windSpeedMps: -1.2345,
        gradePercent: -1.125,
        rollingResistance: 0.00405,
        windResistanceKgPerM: 0.505,
      }),
    ]).toEqual([17, 46, 251, 144, 255, 41, 51]);
    expect([...simulationCommand({ gradePercent: 0 })]).toEqual([17, 0, 0, 0, 0, 40, 51]);
  });

  it("retains exact wire bounds and half-RPM cadence validation", () => {
    expect([...targetPowerCommand(-32768)]).toEqual([5, 0, 128]);
    expect([...targetPowerCommand(32767)]).toEqual([5, 255, 127]);
    expect([...targetResistanceCommand(-3276.8)]).toEqual([4, 0, 128]);
    expect([...targetResistanceCommand(3276.7)]).toEqual([4, 255, 127]);
    expect([...targetResistanceCommand(25.5, "uint8")]).toEqual([4, 255]);
    expect([...targetCadenceCommand(90.5)]).toEqual([20, 181, 0]);
    expect([...targetCadenceCommand(32767.5)]).toEqual([20, 255, 255]);
    expect(() => targetCadenceCommand(90.25)).toThrow(FtmsRangeError);
    expect([
      ...simulationCommand({
        windSpeedMps: -32.768,
        gradePercent: 327.67,
        rollingResistance: 0.0255,
        windResistanceKgPerM: 2.55,
      }),
    ]).toEqual([17, 0, 128, 255, 127, 255, 255]);
  });

  it("preserves existing cadence coercion for untyped JavaScript callers", () => {
    // The public TypeScript input stays number; do not incidentally tighten the
    // existing JS behavior while swapping the packet encoder underneath it.
    expect([...targetCadenceCommand("90.5" as unknown as number)]).toEqual([20, 181, 0]);
    expect([...targetCadenceCommand(null as unknown as number)]).toEqual([20, 0, 0]);
    expect([...targetCadenceCommand(true as unknown as number)]).toEqual([20, 2, 0]);
    expect(() => targetCadenceCommand("invalid" as unknown as number)).toThrow(FtmsRangeError);
  });

  it("preserves public error classes and messages before invoking the codec", () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => targetPowerCommand(invalid)).toThrow(FtmsRangeError);
      expect(() => targetResistanceCommand(invalid)).toThrow(FtmsRangeError);
      expect(() => targetResistanceCommand(invalid, "uint8")).toThrow(FtmsRangeError);
      expect(() => targetCadenceCommand(invalid)).toThrow(FtmsRangeError);
      expect(() => simulationCommand({ gradePercent: invalid })).toThrow(FtmsRangeError);
    }
    expect(() => targetPowerCommand(32767.5)).toThrow(
      "Target power must be an integer from -32768 to 32767.",
    );
    expect(() => targetResistanceCommand(25.6, "uint8")).toThrow(
      "Encoded resistance level must be an integer from 0 to 255.",
    );
    expect(() => spinDownCommand("invalid" as SpinDownControl)).toThrow(FtmsRangeError);
    expect(() => simulationCommand({ gradePercent: 0, rollingResistance: 0.026 })).toThrow(
      FtmsRangeError,
    );
    expect(() => simulationCommand({ gradePercent: 0, windResistanceKgPerM: -0.01 })).toThrow(
      FtmsRangeError,
    );
    expect(() => simulationCommand({ gradePercent: 0, windSpeedMps: 32.768 })).toThrow(
      FtmsRangeError,
    );
  });

  it("preserves every representable signed16 resistance value through human-unit adaptation", () => {
    for (let raw = -32768; raw <= 32767; raw++) {
      const packet = targetResistanceCommand(raw / 10);
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      if (packet.length !== 3 || packet[0] !== 4 || view.getInt16(1, true) !== raw) {
        throw new Error(`Resistance encoding changed for raw value ${raw}`);
      }
    }
  });
  it("encodes signed little-endian ERG power", () => {
    expect([...targetPowerCommand(200)]).toEqual([0x05, 0xc8, 0x00]);
    expect([...targetPowerCommand(-20)]).toEqual([0x05, 0xec, 0xff]);
  });

  it("encodes resistance with 0.1 resolution", () => {
    expect([...targetResistanceCommand(10)]).toEqual([0x04, 0x64, 0x00]);
    expect([...targetResistanceCommand(5.5)]).toEqual([0x04, 0x37, 0x00]);
    expect([...targetResistanceCommand(-1)]).toEqual([0x04, 0xf6, 0xff]);
  });

  it("supports the legacy FTMS 1.0 UINT8 resistance command", () => {
    expect([...targetResistanceCommand(10, "uint8")]).toEqual([0x04, 0x64]);
    expect(() => targetResistanceCommand(-1, "uint8")).toThrow(/0 to 255/);
  });

  it("rejects values outside the control-point field", () => {
    expect(() => targetResistanceCommand(3_276.8)).toThrow(/-32768 to 32767/);
    expect(() => targetPowerCommand(Number.NaN)).toThrow(/-32768 to 32767/);
  });

  it("encodes indoor bike simulation parameters", () => {
    expect([
      ...simulationCommand({
        windSpeedMps: -1.5,
        gradePercent: 4.25,
        rollingResistance: 0.004,
        windResistanceKgPerM: 0.51,
      }),
    ]).toEqual([0x11, 0x24, 0xfa, 0xa9, 0x01, 40, 51]);
  });
});
