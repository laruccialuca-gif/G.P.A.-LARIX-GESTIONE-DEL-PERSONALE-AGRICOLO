import Foundation
import PDFKit
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: pdf-ocr <path>\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
guard let pdfURL = URL(string: "file://" + pdfPath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!),
      let pdf = PDFDocument(url: pdfURL) else {
    fputs("Cannot open PDF: \(pdfPath)\n", stderr)
    exit(1)
}

func escapeJson(_ s: String) -> String {
    return s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "")
}

for pageIndex in 0..<pdf.pageCount {
    guard let page = pdf.page(at: pageIndex) else { continue }

    let thumb = page.thumbnail(of: CGSize(width: 1700, height: 2400), for: .mediaBox)
    guard let tiffData = thumb.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let cgImage = bitmap.cgImage else { continue }

    var itemsJson: [String] = []

    let request = VNRecognizeTextRequest { req, _ in
        guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
        for ob in obs {
            guard let candidate = ob.topCandidates(1).first else { continue }
            let text = escapeJson(candidate.string)
            let bb = ob.boundingBox // normalized, origin bottom-left
            let item = "{\"t\":\"\(text)\",\"x\":\(String(format:"%.4f",bb.minX)),\"y\":\(String(format:"%.4f",bb.minY)),\"w\":\(String(format:"%.4f",bb.width)),\"h\":\(String(format:"%.4f",bb.height))}"
            itemsJson.append(item)
        }
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["it", "en"]
    request.usesLanguageCorrection = false

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try? handler.perform([request])

    print("{\"page\":\(pageIndex),\"items\":[\(itemsJson.joined(separator: ","))]}")
}
