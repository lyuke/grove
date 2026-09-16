import AppKit
import Foundation

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "resources/icon.png"
let size = 1024
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(calibratedRed: 0.10, green: 0.16, blue: 0.12, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 62, y: 62, width: 900, height: 900), xRadius: 210, yRadius: 210).fill()
NSColor(calibratedRed: 0.25, green: 0.34, blue: 0.23, alpha: 1).setStroke()
let border = NSBezierPath(roundedRect: NSRect(x: 80, y: 80, width: 864, height: 864), xRadius: 195, yRadius: 195)
border.lineWidth = 3; border.stroke()
NSColor(calibratedRed: 0.73, green: 0.87, blue: 0.61, alpha: 1).setStroke()
let leaf = NSBezierPath()
leaf.move(to: NSPoint(x: 319, y: 366))
leaf.curve(to: NSPoint(x: 735, y: 747), controlPoint1: NSPoint(x: 197, y: 660), controlPoint2: NSPoint(x: 630, y: 541))
leaf.curve(to: NSPoint(x: 319, y: 366), controlPoint1: NSPoint(x: 878, y: 365), controlPoint2: NSPoint(x: 518, y: 246))
leaf.lineWidth = 28; leaf.lineCapStyle = .round; leaf.lineJoinStyle = .round; leaf.stroke()
let stem = NSBezierPath()
stem.move(to: NSPoint(x: 265, y: 254))
stem.curve(to: NSPoint(x: 621, y: 539), controlPoint1: NSPoint(x: 318, y: 452), controlPoint2: NSPoint(x: 486, y: 411))
stem.lineWidth = 28; stem.lineCapStyle = .round; stem.stroke()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
