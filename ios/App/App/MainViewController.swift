import Capacitor
import UIKit

/// La vue de l'app : celle de Capacitor, avec notre module MIDI enregistré au démarrage.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MidiPlugin())
    }

    // Au piano, l'écran reste propre : pas de barre d'état ni de barre d'accueil qui insiste.
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}
