
import { 
  ApiPromise, 
  Keyring, 
  WsProvider,
} from '@polkadot/api';
import {
  cryptoWaitReady,
  mnemonicGenerate,
} from '@polkadot/util-crypto';
import {
  stringToU8a, 
  u8aToString, 
  u8aToHex, 
  stringToHex, 
  promisify,
  bnToBn,
  BN_MILLION
} from '@polkadot/util';
import BN from 'bn.js';
import extension from './extension';

import GluonPallet from './pallet/gluon';

const types: any = require('./res/types');
const rpc:any = require('./res/rpc');
const errors:any = require('./res/errors');

const {_} = require('tearust_utils');


type Layer1Opts = {
  ws_url: string,
  http_url?: string,
  system_top_up_account?: string,
  faucet_value?: number,
};

export default class {

  opts: any;
  api: ApiPromise | null;
  extension: any;

  gluonPallet: GluonPallet | null;

  constructor(opts: Layer1Opts){
    if(!opts || !opts.ws_url){
      throw 'Invalid Layer1 options';
    }
    this.opts = _.extend({
      http_url: '',
      system_top_up_account: 'Ferdie',
      faucet_value: 1000,
    }, opts);

    this.api = null;
    this.gluonPallet = null;

    this.extension = extension;
  }

  async init(){
    const wsProvider = new WsProvider(this.opts.ws_url);
    this.api = await ApiPromise.create({
      provider: wsProvider,
      types,
      rpc
    });

    await this.extension.init();
    await cryptoWaitReady();
  }

  async getLayer1Nonce(address: string){
    const api = this.getApi();
    const nonce = await api.rpc.system.accountNextIndex(address);
    return nonce;
  }

  getGluonPallet(): GluonPallet {
    if(!this.gluonPallet){
      this.gluonPallet = new GluonPallet(this);
    }

    return this.gluonPallet;
  }

  getApi(): ApiPromise{
    const api = this.api;
    if(!api){
      throw 'Get Layer1 Api failed';
    }
    return api;
  }

  async getRealAccountBalance(account: string): Promise<number> {
    const api = this.getApi();
    let { data: { free: previousFree }, nonce: previousNonce } = await api.query.system.account(account);

    const bn = parseInt(previousFree.toString(), 10);
    return bn;
  }

  async getAccountBalance(account: string): Promise<number>{
    const real_balance = await this.getRealAccountBalance(account);

    const free = real_balance / this.asUnit();
    return Math.floor(free*10000)/10000;
  }

  getAccountFrom(mn: string){
    if(mn.split(' ').length === 1){
      mn = '//'+mn;
    }

    const keyring = new Keyring({ type: 'sr25519' })
    const ac = keyring.addFromUri(mn);
    return ac;
  }

  mnemonicGenerate() {
    return mnemonicGenerate();
  }

  asUnit(num: number=1): number{
    const yi = new BN(BN_MILLION);
    const million = new BN(BN_MILLION);
    const unit: BN = yi.mul(million);

    return parseInt(unit.mul(new BN(num)).toString(10), 10);
  }

  async faucet(target_address: string){
    const da = this.getAccountFrom(this.opts.system_top_up_account);
    const total = this.asUnit(this.opts.faucet_value);
    console.log('System account balance =>', await this.getRealAccountBalance(da.address));
    const api = this.getApi();
    const transfer_tx = api.tx.balances.transfer(target_address, total);

    await this.sendTx(da, transfer_tx);
  }

  async promisify(fn: Function) {
    return promisify(this, async (cb) => {
      try {
        await fn(cb);
      } catch (e) {
        cb(e.toString());
      }
    });
  }

  async buildAccount(account: any){
    if(_.isString(account)){
      return await this.extension.setSignerForAddress(account, this.getApi());
    }
    else{
      return account;
    }
  }

  async sendTx(account: any, tx: any, cb_true_data?: any){
    await this.buildAccount(account)
    return this.promisify(async (cb: Function)=>{
      await tx.signAndSend(account, (param: any)=>{
        this._transactionCallback(param, (error: any) => {
          if(error){
            cb(error);
          }
          else{
            cb(null, cb_true_data);
          }
        });
        
      });
    })
  }

  _transactionCallback(param: any, cb: Function) {
    const {events = [], status}: {events: any[], status: any} = param;
    if (status.isInBlock) {
      console.log('Included at block hash', status.asInBlock.toHex());
      console.log('Events:');

      const opts: any = {};
      events.forEach(({event: {data, method, section}, phase}) => {
        console.log(
          '\t',
          phase.toString(),
          `: ${section}.${method}`,
          data.toString(),
        );
        if (method === 'ExtrinsicFailed') {
          const error = this._findError(data);
          if (error) {
            cb(error);
            return;
          }
          opts.data = data;
        }
      });

      cb(null, opts);
    } else if (status.isFinalized) {
      console.log('Finalized block hash', status.asFinalized.toHex());
    }
  }

  _findError(data: any) {
    let err = false;
    let type_index = -1;
    _.each(data.toJSON(), (p) => {
      if (!_.isUndefined(_.get(p, 'Module.error'))) {
        err = _.get(p, 'Module.error');
        type_index = _.get(p, 'Module.index');
        return false;
      }
    });

    if (err !== false) {
      return _.get(errors, type_index+'.'+err, 'Not Found in Error definination with [index: '+type_index+', error: '+err+']');
    }

    return null;
  }


}