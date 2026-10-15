import Capacitor
import CoreAudioKit
import CoreMIDI
import UIKit

/// Le MIDI de l'iPhone pour l'app web, qui n'a pas de Web MIDI sous iOS.
/// Écoute tous les claviers (Bluetooth ou câble), envoie des notes au piano, et ouvre
/// l'écran d'Apple qui connecte un piano en Bluetooth. Côté web : src/input/native-midi.ts.
@objc(MidiPlugin)
public class MidiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MidiPlugin"
    public let jsName = "Midi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBluetooth", returnType: CAPPluginReturnPromise),
    ]

    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var outputPort = MIDIPortRef()
    /// Sources déjà écoutées, par identifiant unique.
    private var connected = Set<MIDIUniqueID>()

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.client == 0 {
                MIDIClientCreateWithBlock("Piano" as CFString, &self.client) { [weak self] _ in
                    // Un piano apparaît ou disparaît (Bluetooth connecté, câble branché…).
                    DispatchQueue.main.async {
                        self?.connectSources()
                        self?.notifyDevices()
                    }
                }
                MIDIInputPortCreateWithProtocol(self.client, "Entrée" as CFString, ._1_0, &self.inputPort) {
                    [weak self] list, source in
                    self?.receive(list, from: source)
                }
                MIDIOutputPortCreate(self.client, "Sortie" as CFString, &self.outputPort)
            }
            self.connectSources()
            call.resolve(self.devices())
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let bytes = call.getArray("data", Int.self), bytes.count >= 2 else {
            call.reject("data attendu : [statut, donnée 1, donnée 2]")
            return
        }
        let wanted = call.getString("id").flatMap { Int32($0) }
        for index in 0..<MIDIGetNumberOfDestinations() {
            let destination = MIDIGetDestination(index)
            if let wanted, uniqueID(destination) != wanted { continue }
            // Un message MIDI 1.0 de canal tient dans un mot « UMP » de type 2.
            var word: UInt32 = 0x2000_0000 | UInt32(bytes[0] & 0xFF) << 16 | UInt32(bytes[1] & 0x7F) << 8
            if bytes.count > 2 { word |= UInt32(bytes[2] & 0x7F) }
            var list = MIDIEventList()
            let packet = MIDIEventListInit(&list, ._1_0)
            MIDIEventListAdd(&list, MemoryLayout<MIDIEventList>.size, packet, 0, 1, &word)
            MIDISendEventList(outputPort, destination, &list)
        }
        call.resolve()
    }

    @objc func showBluetooth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let central = CABTMIDICentralViewController()
            let navigation = UINavigationController(rootViewController: central)
            central.navigationItem.rightBarButtonItem = UIBarButtonItem(
                systemItem: .done,
                primaryAction: UIAction { [weak navigation] _ in navigation?.dismiss(animated: true) }
            )
            navigation.modalPresentationStyle = .formSheet
            self.bridge?.viewController?.present(navigation, animated: true)
            call.resolve()
        }
    }

    // MARK: - Interne

    private func connectSources() {
        for index in 0..<MIDIGetNumberOfSources() {
            let source = MIDIGetSource(index)
            let id = uniqueID(source)
            if connected.contains(id) { continue }
            // L'identifiant voyage avec chaque message, pour savoir de quel clavier il vient.
            let tag = UnsafeMutableRawPointer(bitPattern: Int(UInt32(bitPattern: id)) | 0x1_0000_0000)
            if MIDIPortConnectSource(inputPort, source, tag) == noErr { connected.insert(id) }
        }
    }

    private func receive(_ list: UnsafePointer<MIDIEventList>, from source: UnsafeMutableRawPointer?) {
        let id = source.map { Int32(truncatingIfNeeded: Int(bitPattern: $0)) } ?? 0
        var messages: [[Int]] = []
        for packet in list.unsafeSequence() {
            let count = Int(packet.pointee.wordCount)
            withUnsafeBytes(of: packet.pointee.words) { raw in
                let words = raw.bindMemory(to: UInt32.self)
                var i = 0
                while i < min(count, words.count) {
                    let word = words[i]
                    let type = word >> 28
                    // Type 2 : message MIDI 1.0 de canal (note, pédale…). Les autres types sont sautés.
                    if type == 0x2 {
                        messages.append([Int((word >> 16) & 0xFF), Int((word >> 8) & 0x7F), Int(word & 0x7F)])
                    }
                    i += Self.wordsPerMessage[Int(type)]
                }
            }
        }
        guard !messages.isEmpty else { return }
        DispatchQueue.main.async {
            for data in messages {
                self.notifyListeners("message", data: ["data": data, "id": String(id)])
            }
        }
    }

    /// Taille d'un message UMP selon son type (4 premiers bits).
    private static let wordsPerMessage = [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]

    private func notifyDevices() {
        notifyListeners("devices", data: devices())
    }

    private func devices() -> [String: Any] {
        func list(_ count: Int, _ endpoint: (Int) -> MIDIEndpointRef) -> [[String: String]] {
            (0..<count).map { index in
                let ref = endpoint(index)
                return ["id": String(uniqueID(ref)), "name": name(ref)]
            }
        }
        return [
            "inputs": list(MIDIGetNumberOfSources()) { MIDIGetSource($0) },
            "outputs": list(MIDIGetNumberOfDestinations()) { MIDIGetDestination($0) },
        ]
    }

    private func uniqueID(_ ref: MIDIObjectRef) -> MIDIUniqueID {
        var id: MIDIUniqueID = 0
        MIDIObjectGetIntegerProperty(ref, kMIDIPropertyUniqueID, &id)
        return id
    }

    private func name(_ ref: MIDIObjectRef) -> String {
        var value: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(ref, kMIDIPropertyDisplayName, &value)
        return (value?.takeRetainedValue() as String?) ?? "Clavier MIDI"
    }
}
