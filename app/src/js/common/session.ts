import _ from 'lodash'
import { Store } from 'redux'
import { StateWithHistory } from 'redux-undo'
import * as THREE from 'three'
import * as types from '../action/types'
import { Window } from '../components/window'
import { Label3DList } from '../drawable/3d/label3d_list'
import { State } from '../functional/types'
import { configureStore } from './configure_store'
import { Track } from './track'

export const enum ConnectionStatus {
  SAVED, SAVING, RECONNECTING, UNSAVED
}

/**
 * Singleton session class
 */
class Session {
  /** The store to save states */
  public store: Store<StateWithHistory<State>>
  /** Images of the session */
  public images: Array<{[id: number]: HTMLImageElement}>
  /** Point cloud */
  public pointClouds: Array<{[id: number]: THREE.Points}>
  /** 3d label list */
  public label3dList: Label3DList
  /** map between track id and track objects */
  public tracks: {[trackId: number]: Track}
  /** whether tracking is enabled */
  public tracking: boolean
  /** whether track linking is enabled */
  public trackLinking: boolean
  /** Current tracking policy type */
  public currentPolicyType: string
  /** The window component */
  public window?: Window
  /** Whether autosave is enabled */
  public autosave: boolean
  /** Dev mode */
  public devMode: boolean
  /** if in test mode, needed for integration and end to end testing */
  // TODO: when we move to node move this into state
  public testMode: boolean
  /** Connection status for saving */
  public status: ConnectionStatus
  /** Overwriteable function that adds side effects to state change */
  public applyStatusEffects: () => void
  /** The hashed list of keys currently down */
  public keyDownMap: { [key: string]: boolean }

  public showShortcuts: () => void;

  constructor () {
    this.images = []
    this.pointClouds = []
    this.label3dList = new Label3DList()
    this.tracks = {}
    this.tracking = true
    this.trackLinking = false
    this.currentPolicyType = ''
    this.status = ConnectionStatus.UNSAVED
    this.autosave = false
    // TODO: make it configurable in the url
    this.devMode = true
    this.applyStatusEffects = () => { return }
    this.testMode = false
    this.store = configureStore({}, this.devMode)
    this.keyDownMap = {}
    this.showShortcuts = () => {};
  }

  /**
   * Get current state in store
   * @return {State}
   */
  public getState (): State {
    return this.store.getState().present
  }

  /**
   * Get the id of the current session
   */
  public get id (): string {
    return this.getState().session.id
  }

  /**
   * Get the number of items in the current session
   */
  public get numItems (): number {
    return Math.max(this.images.length, this.pointClouds.length)
  }

  /**
   * Wrapper for redux store dispatch
   * @param {types.ActionType} action: action description
   */
  public dispatch (action: types.ActionType): void {
    this.store.dispatch(action)
  }

  /**
   * Subscribe all the controllers to the states
   * @param {Function} callback: view component
   */
  public subscribe (callback: () => void) {
    this.store.subscribe(callback)
  }

  /**
   * Update the status, then call overwritable function
   * This should update any parts of the view that depend on status
   * @param {ConnectionStatus} newStatus: new value of status
   */
  public updateStatus (newStatus: ConnectionStatus): ConnectionStatus {
    this.status = newStatus
    this.applyStatusEffects()
    return newStatus
  }

  /**
   * Callback function when key is down
   * @param {KeyboardEvent} e - event
   */
  public onKeyDown (e: KeyboardEvent, callback: (e: KeyboardEvent) => void) {
    if (this.status === ConnectionStatus.RECONNECTING) {
      return
    }

    const key = e.key
    this.keyDownMap[key] = true
    callback(e);
  }

  /**
   * Callback function when key is up
   * @param {KeyboardEvent} e - event
   */
  public onKeyUp (e: KeyboardEvent, callback: (e: KeyboardEvent) => void) {
    const key = e.key
    delete this.keyDownMap[key]
    callback(e);
  }
  /**
   * Whether a specific key is pressed down
   * @param {string} key - the key to check
   * @return {boolean}
   */
  public isKeyDown (key: string): boolean {
    return this.keyDownMap[key]
  }
}

export default new Session()
