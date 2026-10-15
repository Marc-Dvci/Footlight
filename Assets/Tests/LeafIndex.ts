import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {DoorwayFreezeScenario} from "./DoorwayFreezeScenario"
import {PinchScenario} from "./PinchScenario"
import {StepSliderScenario} from "./StepSliderScenario"
import {TodayLogScenario} from "./TodayLogScenario"
import {WalkThroughScenario} from "./WalkThroughScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "c1-doorway-freeze", typename: DoorwayFreezeScenario.getTypeName()},
    {id: "c2-step-slider", typename: StepSliderScenario.getTypeName()},
    {id: "c3-pinch-anywhere", typename: PinchScenario.getTypeName()},
    {id: "c4-walk-through", typename: WalkThroughScenario.getTypeName()},
    {id: "c5-today-log", typename: TodayLogScenario.getTypeName()},
  ]
}
