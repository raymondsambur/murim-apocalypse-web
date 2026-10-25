import { describe, expect, it } from 'vitest';
import { parseChatInput, splitTarget } from './chatCommands';

const ctx = { channel: 'local' as const, whisperTo: null, lastWhisper: null };

describe('parseChatInput', () => {
  it('sends plain text on the selected channel', () => {
    expect(parseChatInput('hello', ctx)).toEqual({ kind: 'send', ch: 'local', text: 'hello' });
    expect(parseChatInput('  hi  ', { ...ctx, channel: 'world' })).toEqual({ kind: 'send', ch: 'world', text: 'hi' });
  });

  it('ignores empty input', () => {
    expect(parseChatInput('   ', ctx)).toEqual({ kind: 'empty' });
  });

  it('parses /w name message, including aliases', () => {
    expect(parseChatInput('/w Zed come here', ctx)).toEqual({ kind: 'send', ch: 'whisper', to: 'Zed', text: 'come here' });
    expect(parseChatInput('/tell Zed hi', ctx)).toMatchObject({ ch: 'whisper', to: 'Zed' });
  });

  it('supports quoted and known multi-word names', () => {
    expect(parseChatInput('/w "Han Gyeom" ready?', ctx)).toEqual({ kind: 'send', ch: 'whisper', to: 'Han Gyeom', text: 'ready?' });
    expect(parseChatInput('/w Han Gyeom ready?', { ...ctx, knownNames: ['Han Gyeom'] })).toMatchObject({ to: 'Han Gyeom', text: 'ready?' });
    expect(splitTarget('Han Gyeom', ['Han Gyeom'])).toEqual({ name: 'Han Gyeom', text: '' });
  });

  it('switches channel when the command has no message', () => {
    expect(parseChatInput('/world', ctx)).toEqual({ kind: 'switch', ch: 'world' });
    expect(parseChatInput('/w Zed', ctx)).toEqual({ kind: 'switch', ch: 'whisper', to: 'Zed' });
  });

  it('sends channel commands with text', () => {
    expect(parseChatInput('/world selling herbs', ctx)).toEqual({ kind: 'send', ch: 'world', text: 'selling herbs' });
    expect(parseChatInput('/sect meet at dawn', ctx)).toMatchObject({ ch: 'sect' });
  });

  it('/r replies to the last whisperer or complains', () => {
    expect(parseChatInput('/r thanks', { ...ctx, lastWhisper: 'Zed' })).toEqual({ kind: 'send', ch: 'whisper', to: 'Zed', text: 'thanks' });
    expect(parseChatInput('/r thanks', ctx)).toMatchObject({ kind: 'error', key: 'chat.err.noReply' });
  });

  it('whisper channel needs a target; known target is used', () => {
    expect(parseChatInput('psst', { ...ctx, channel: 'whisper' })).toMatchObject({ kind: 'error', key: 'chat.err.noTarget' });
    expect(parseChatInput('psst', { ...ctx, channel: 'whisper', whisperTo: 'Zed' })).toEqual({ kind: 'send', ch: 'whisper', to: 'Zed', text: 'psst' });
  });

  it('reports unknown commands, supports help and the // escape', () => {
    expect(parseChatInput('/dance', ctx)).toMatchObject({ kind: 'error', key: 'chat.err.unknown', params: { cmd: '/dance' } });
    expect(parseChatInput('/help', ctx)).toEqual({ kind: 'help' });
    expect(parseChatInput('//shrug', ctx)).toEqual({ kind: 'send', ch: 'local', text: '/shrug' });
  });

  it('rejects messages over 200 characters', () => {
    expect(parseChatInput('x'.repeat(201), ctx)).toMatchObject({ kind: 'error', key: 'chat.err.tooLong' });
    expect(parseChatInput('x'.repeat(200), ctx)).toMatchObject({ kind: 'send' });
  });
});
