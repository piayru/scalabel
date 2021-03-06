import createStyles from '@material-ui/core/styles/createStyles'
import { withStyles } from '@material-ui/core/styles/index'
import * as React from 'react'
import * as THREE from 'three'
import Session from '../common/session'
import { ViewerConfigTypeName } from '../common/types'
import { IntrinsicCamera } from '../drawable/3d/intrinsic_camera'
import { Label3DHandler } from '../drawable/3d/label3d_handler'
import { getCurrentViewerConfig, isCurrentFrameLoaded } from '../functional/state_util'
import { Image3DViewerConfigType, PointCloudViewerConfigType, State } from '../functional/types'
import { MAX_SCALE, MIN_SCALE, updateCanvasScale } from '../view_config/image'
import { convertMouseToNDC, updateThreeCameraAndRenderer } from '../view_config/point_cloud'
import { DrawableCanvas } from './viewer'

const styles = () => createStyles({
  label3d_canvas: {
    position: 'absolute',
    height: '100%',
    width: '100%'
  }
})

interface ClassType {
  /** CSS canvas name */
  label3d_canvas: string
}

interface Props {
  /** CSS class */
  classes: ClassType
  /** container */
  display: HTMLDivElement | null
  /** viewer id */
  id: number
}

/**
 * Normalize mouse coordinates to make canvas left top origin
 * @param x
 * @param y
 * @param canvas
 */
function normalizeCoordinatesToCanvas (
  x: number, y: number, canvas: HTMLCanvasElement): number[] {
  return [
    x - canvas.getBoundingClientRect().left,
    y - canvas.getBoundingClientRect().top
  ]
}

/**
 * Canvas Viewer
 */
export class Label3dCanvas extends DrawableCanvas<Props> {
  /** Canvas to draw on */
  private canvas: HTMLCanvasElement | null
  /** Container */
  private display: HTMLDivElement | null
  /** Current scale */
  private scale: number
  /** ThreeJS Renderer */
  private renderer?: THREE.WebGLRenderer
  /** ThreeJS Camera */
  private camera: THREE.Camera
  /** raycaster */
  private _raycaster: THREE.Raycaster
  /** The hashed list of keys currently down */
  private _keyDownMap: { [key: string]: boolean }

  /** drawable label list */
  private _labelHandler: Label3DHandler

  /** key up listener */
  private _keyUpListener: (e: KeyboardEvent) => void
  /** key down listener */
  private _keyDownListener: (e: KeyboardEvent) => void
  /** drawable callback */
  private _drawableUpdateCallback: () => void

  /**
   * Constructor, ons subscription to store
   * @param {Object} props: react props
   */
  constructor (props: Readonly<Props>) {
    super(props)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

    this._labelHandler = new Label3DHandler(this.camera)

    this.display = null
    this.canvas = null
    this.scale = 1

    this._raycaster = new THREE.Raycaster()
    this._raycaster.near = 1.0
    this._raycaster.far = 100.0
    this._raycaster.linePrecision = 0.02

    this._keyDownMap = {}

    this._keyUpListener = (e) => { this.onKeyUp(e) }
    this._keyDownListener = (e) => { this.onKeyDown(e) }
    this._drawableUpdateCallback = this.renderThree.bind(this)
  }

  /**
   * Mount callback
   */
  public componentDidMount () {
    super.componentDidMount()
    document.addEventListener('keydown', this._keyDownListener)
    document.addEventListener('keyup', this._keyUpListener)
    Session.label3dList.subscribe(this._drawableUpdateCallback)
  }

  /**
   * Unmount callback
   */
  public componentWillUnmount () {
    super.componentWillUnmount()
    document.removeEventListener('keydown', this._keyDownListener)
    document.removeEventListener('keyup', this._keyUpListener)
    Session.label3dList.unsubscribe(this._drawableUpdateCallback)
  }

  /**
   * Render function
   * @return {React.Fragment} React fragment
   */
  public render () {
    const { classes } = this.props

    let canvas = (<canvas
      key={`label3d-canvas-${this.props.id}`}
      className={classes.label3d_canvas}
      ref={(ref) => { this.initializeRefs(ref) }}
      onMouseDown={(e) => { this.onMouseDown(e) }}
      onMouseUp={(e) => { this.onMouseUp(e) }}
      onMouseMove={(e) => { this.onMouseMove(e) }}
      onDoubleClick={(e) => { this.onDoubleClick(e) }}
    />)

    if (this.display) {
      const displayRect = this.display.getBoundingClientRect()
      canvas = React.cloneElement(
        canvas,
        { height: displayRect.height, width: displayRect.width }
      )
    }

    return canvas
  }

  /**
   * Handles canvas redraw
   * @return {boolean}
   */
  public redraw (): boolean {
    if (this.canvas) {
      const sensor =
        this.state.user.viewerConfigs[this.props.id].sensor
      if (isCurrentFrameLoaded(this.state, sensor)) {
        this.updateRenderer()
        this.renderThree()
      } else if (this.renderer) {
        this.renderer.clear()
      }
    }
    return true
  }

  /**
   * Handle mouse down
   * @param {React.MouseEvent<HTMLCanvasElement>} e
   */
  public onMouseDown (e: React.MouseEvent<HTMLCanvasElement>) {
    if (!this.canvas || this.checkFreeze()) {
      return
    }
    const normalized = normalizeCoordinatesToCanvas(
      e.clientX, e.clientY, this.canvas
    )
    const NDC = convertMouseToNDC(
      normalized[0],
      normalized[1],
      this.canvas
    )
    const x = NDC[0]
    const y = NDC[1]
    if (this._labelHandler.onMouseDown(x, y)) {
      e.stopPropagation()
    }
  }

  /**
   * Handle mouse up
   * @param {React.MouseEvent<HTMLCanvasElement>} e
   */
  public onMouseUp (e: React.MouseEvent<HTMLCanvasElement>) {
    if (!this.canvas || this.checkFreeze()) {
      return
    }
    if (this._labelHandler.onMouseUp()) {
      e.stopPropagation()
    }
  }

  /**
   * Handle mouse move
   * @param {React.MouseEvent<HTMLCanvasElement>} e
   */
  public onMouseMove (e: React.MouseEvent<HTMLCanvasElement>) {
    if (!this.canvas || this.checkFreeze()) {
      return
    }

    const normalized = normalizeCoordinatesToCanvas(
      e.clientX, e.clientY, this.canvas
    )

    const newX = normalized[0]
    const newY = normalized[1]

    const NDC = convertMouseToNDC(
      newX,
      newY,
      this.canvas
    )
    const x = NDC[0]
    const y = NDC[1]

    this.camera.updateMatrixWorld(true)
    this._raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera)

    const shapes = Session.label3dList.raycastableShapes
    const intersects = this._raycaster.intersectObjects(
      // Need to do this middle conversion because ThreeJS does not specify
      // as readonly, but this should be readonly for all other purposes
      shapes as unknown as THREE.Object3D[], false
    )

    const consumed = (intersects && intersects.length > 0) ?
      this._labelHandler.onMouseMove(x, y, intersects[0]) :
      this._labelHandler.onMouseMove(x, y)
    if (consumed) {
      e.stopPropagation()
    }

    Session.label3dList.onDrawableUpdate()
  }

  /**
   * Handle keyboard events
   * @param {KeyboardEvent} e
   */
  public onKeyDown (e: KeyboardEvent) {
    if (this.checkFreeze() || Session.activeViewerId !== this.props.id) {
      return
    }

    this._keyDownMap[e.key] = true

    if (this._labelHandler.onKeyDown(e)) {
      Session.label3dList.onDrawableUpdate()
    }
  }

  /**
   * Handle keyboard events
   * @param {KeyboardEvent} e
   */
  public onKeyUp (e: KeyboardEvent) {
    if (this.checkFreeze() || Session.activeViewerId !== this.props.id) {
      return
    }

    this._keyDownMap[e.key] = true

    if (this._labelHandler.onKeyUp(e)) {
      Session.label3dList.onDrawableUpdate()
    }
  }

  /**
   * notify state is updated
   */
  protected updateState (state: State): void {
    if (this.display !== this.props.display) {
      this.display = this.props.display
      this.forceUpdate()
    }

    this.camera.layers.set(
      this.props.id - Math.min(
        ...Object.keys(this.state.user.viewerConfigs).map((key) => Number(key))
      )
    )

    const item = state.task.items[state.user.select.item]
    const viewerConfig = this.state.user.viewerConfigs[this.props.id]
    const sensorId = viewerConfig.sensor
    for (const key of Object.keys(item.labels)) {
      const id = Number(key)
      if (item.labels[id].sensors.includes(sensorId)) {
        const label = Session.label3dList.get(id)
        if (label) {
          for (const shape of label.shapes()) {
            shape.layers.enable(this.props.id)
          }
        }
      }
    }

    if (this.props.id in this.state.user.viewerConfigs) {
      if (viewerConfig.type === ViewerConfigTypeName.IMAGE_3D) {
        if (viewerConfig.sensor in this.state.task.sensors) {
          const sensor = this.state.task.sensors[sensorId]
          if (sensor.intrinsics &&
              isCurrentFrameLoaded(state, viewerConfig.sensor)) {
            const image =
              Session.images[state.user.select.item][viewerConfig.sensor]
            this.camera = new IntrinsicCamera(
              sensor.intrinsics,
              image.width,
              image.height
            )
          }
        }
      } else {
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
      }
      this._labelHandler.camera = this.camera
    }

    if (Session.activeViewerId === this.props.id) {
      Session.label3dList.setActiveCamera(this.camera)
    }
    this._labelHandler.updateState(state, state.user.select.item, this.props.id)
  }

  /**
   * Render ThreeJS Scene
   */
  private renderThree () {
    const state = this.state
    const sensor =
      this.state.user.viewerConfigs[this.props.id].sensor
    if (this.renderer && isCurrentFrameLoaded(state, sensor)) {
      this.renderer.render(Session.label3dList.scene, this.camera)
    } else if (this.renderer) {
      this.renderer.clear()
    }
  }

  /**
   * Handle double click
   * @param _e
   */
  private onDoubleClick (e: React.MouseEvent<HTMLCanvasElement>) {
    if (this._labelHandler.onDoubleClick()) {
      e.stopPropagation()
    }
  }

  /**
   * Set references to div elements and try to initialize renderer
   * @param {HTMLDivElement} component
   * @param {string} componentType
   */
  private initializeRefs (component: HTMLCanvasElement | null) {
    const sensor =
      this.state.user.viewerConfigs[this.props.id].sensor
    if (!component || !isCurrentFrameLoaded(this.state, sensor)) {
      return
    }

    if (component.nodeName === 'CANVAS') {
      if (this.canvas !== component) {
        this.canvas = component
        const rendererParams = {
          canvas: this.canvas,
          alpha: true,
          antialias: true
        }
        this.renderer = new THREE.WebGLRenderer(rendererParams)
        this.forceUpdate()
      }

      const viewerConfig = getCurrentViewerConfig(
        this.state, this.props.id
      )
      if (this.canvas && this.display &&
          viewerConfig.type === ViewerConfigTypeName.IMAGE_3D) {
        const img3dConfig = viewerConfig as Image3DViewerConfigType
        if (img3dConfig.viewScale >= MIN_SCALE &&
            img3dConfig.viewScale < MAX_SCALE) {
          const newParams =
            updateCanvasScale(
              this.state,
              this.display,
              this.canvas,
              null,
              img3dConfig,
              img3dConfig.viewScale / this.scale,
              false
            )
          this.scale = newParams[3]
        }
      } else if (this.display) {
        this.canvas.removeAttribute('style')
        const displayRect = this.display.getBoundingClientRect()
        this.canvas.width = displayRect.width
        this.canvas.height = displayRect.height
      }

      this.updateRenderer()
    }
  }

  /**
   * Update rendering constants
   */
  private updateRenderer () {
    if (this.canvas && this.renderer) {
      const config = getCurrentViewerConfig(
        this.state, this.props.id
      )
      if (config) {
        switch (config.type) {
          case ViewerConfigTypeName.POINT_CLOUD:
            updateThreeCameraAndRenderer(
              config as PointCloudViewerConfigType,
              this.camera,
              this.canvas,
              this.renderer
            )
            break
          case ViewerConfigTypeName.IMAGE_3D:
            const img3dConfig = config as Image3DViewerConfigType
            const sensor = img3dConfig.sensor
            if (sensor in this.state.task.sensors) {
              const extrinsics = this.state.task.sensors[sensor].extrinsics
              this.camera.position.set(0, 0, 0)
              if (extrinsics) {
                this.camera.quaternion.set(
                  extrinsics.rotation.x,
                  extrinsics.rotation.y,
                  extrinsics.rotation.z,
                  extrinsics.rotation.w
                )
                this.camera.quaternion.multiply(
                  (new THREE.Quaternion()).setFromAxisAngle(
                    new THREE.Vector3(1, 0, 0), Math.PI
                  )
                )
                this.camera.position.set(
                  extrinsics.translation.x,
                  extrinsics.translation.y,
                  extrinsics.translation.z
                )
              }
              if (this.canvas && this.renderer) {
                this.renderer.setSize(
                  this.canvas.width,
                  this.canvas.height
                )
              }
            }
            break
        }
      }
    }
  }
}

export default withStyles(styles, { withTheme: true })(Label3dCanvas)
