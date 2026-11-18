import Foundation

/// Pure-Swift MPEG-TS (H.265/HEVC, H.264/AVC, AAC) to Fragmented MP4 (fMP4) remuxer
/// so Apple AVPlayer decodes HEVC-in-TS streams with full hardware video instead of black screen.
final class TsToFmp4Remuxer {
    struct VideoConfig {
        let isHevc: Bool
        let width: Int
        let height: Int
        let vps: Data?
        let sps: Data
        let pps: Data
    }

    struct AudioConfig {
        let sampleRate: Int
        let channels: Int
        let audioObjectType: Int
        let freqIndex: Int
    }

    struct MediaSample {
        let dts: UInt64 // 90kHz
        let pts: UInt64 // 90kHz
        let isSync: Bool
        let data: Data
    }

    struct ParsedChunk {
        var videoConfig: VideoConfig?
        var audioConfig: AudioConfig?
        var videoSamples: [MediaSample] = []
        var audioSamples: [MediaSample] = []
    }

    // MARK: - TS Parsing

    static func parseTS(_ tsData: Data) -> ParsedChunk {
        var result = ParsedChunk()
        let bytes = [UInt8](tsData)
        let count = bytes.count
        var offset = 0
        // Sync to first 0x47
        while offset < count && bytes[offset] != 0x47 { offset += 1 }

        var pmtPid: UInt16?
        var videoPid: UInt16?
        var audioPid: UInt16?
        var isHevc = false

        var videoPes = Data()
        var hasVideoPes = false

        var audioPes = Data()
        var hasAudioPes = false

        var vpsData: Data?
        var spsData: Data?
        var ppsData: Data?

        func flushVideoPes() {
            guard hasVideoPes, videoPes.count > 9 else { videoPes.removeAll(); hasVideoPes = false; return }
            let (pts, dts, payloadStart) = parsePesHeader(videoPes)
            guard payloadStart < videoPes.count else { videoPes.removeAll(); hasVideoPes = false; return }
            let es = videoPes.subdata(in: payloadStart..<videoPes.count)
            let nalus = splitAnnexBNalus(es)
            var avccData = Data()
            var isSync = false
            for nalu in nalus where !nalu.isEmpty {
                if isHevc {
                    let nType = (nalu[0] >> 1) & 0x3F
                    if nType == 32 { vpsData = nalu; continue }
                    if nType == 33 { spsData = nalu; continue }
                    if nType == 34 { ppsData = nalu; continue }
                    if nType == 19 || nType == 20 || nType == 21 { isSync = true }
                    if nType >= 32 { continue } // skip AUD/SEI/etc or keep only VCL? Keep VCL (0..31)
                } else {
                    let nType = nalu[0] & 0x1F
                    if nType == 7 { spsData = nalu; continue }
                    if nType == 8 { ppsData = nalu; continue }
                    if nType == 5 { isSync = true }
                    if nType == 9 { continue } // AUD
                }
                var lenBE = UInt32(nalu.count).bigEndian
                avccData.append(Data(bytes: &lenBE, count: 4))
                avccData.append(nalu)
            }
            if !avccData.isEmpty {
                result.videoSamples.append(MediaSample(dts: dts, pts: pts, isSync: isSync, data: avccData))
            }
            videoPes.removeAll(keepingCapacity: true)
            hasVideoPes = false
        }

        func flushAudioPes() {
            guard hasAudioPes, audioPes.count > 9 else { audioPes.removeAll(); hasAudioPes = false; return }
            let (pts, _, payloadStart) = parsePesHeader(audioPes)
            guard payloadStart < audioPes.count else { audioPes.removeAll(); hasAudioPes = false; return }
            let es = [UInt8](audioPes.subdata(in: payloadStart..<audioPes.count))
            var idx = 0
            var curPts = pts
            while idx + 7 <= es.count {
                if es[idx] != 0xFF || (es[idx + 1] & 0xF0) != 0xF0 {
                    idx += 1
                    continue
                }
                let protectionAbsent = (es[idx + 1] & 0x01) != 0
                let profile = Int((es[idx + 2] >> 6) & 0x03) + 1
                let freqIdx = Int((es[idx + 2] >> 2) & 0x0F)
                let channels = Int(((es[idx + 2] & 0x01) << 2) | ((es[idx + 3] >> 6) & 0x03))
                let frameLen = (Int(es[idx + 3] & 0x03) << 11) | (Int(es[idx + 4]) << 3) | (Int(es[idx + 5] >> 5) & 0x07)
                let hdrLen = protectionAbsent ? 7 : 9
                guard frameLen > hdrLen, idx + frameLen <= es.count else { break }
                let sr = sampleRateTable[freqIdx]
                if result.audioConfig == nil && sr > 0 {
                    result.audioConfig = AudioConfig(sampleRate: sr, channels: max(1, channels), audioObjectType: profile, freqIndex: freqIdx)
                }
                let rawAac = Data(es[(idx + hdrLen)..<(idx + frameLen)])
                result.audioSamples.append(MediaSample(dts: curPts, pts: curPts, isSync: true, data: rawAac))
                if sr > 0 {
                    curPts += UInt64(1024 * 90000 / sr)
                }
                idx += frameLen
            }
            audioPes.removeAll(keepingCapacity: true)
            hasAudioPes = false
        }

        while offset + 188 <= count {
            if bytes[offset] != 0x47 {
                offset += 1
                continue
            }
            let pusi = (bytes[offset + 1] & 0x40) != 0
            let pid = (UInt16(bytes[offset + 1] & 0x1F) << 8) | UInt16(bytes[offset + 2])
            let afc = (bytes[offset + 3] >> 4) & 0x03
            var pos = offset + 4
            if afc == 2 || afc == 0 {
                offset += 188
                continue
            }
            if afc == 3 {
                let adaptLen = Int(bytes[pos])
                pos += 1 + adaptLen
            }
            let end = offset + 188
            guard pos < end else { offset += 188; continue }

            if pid == 0 {
                if pusi { pos += 1 + Int(bytes[pos]) }
                if pos + 12 <= end {
                    let sectionLen = (Int(bytes[pos + 1] & 0x0F) << 8) | Int(bytes[pos + 2])
                    let secEnd = min(end, pos + 3 + sectionLen - 4)
                    var p = pos + 8
                    while p + 4 <= secEnd {
                        let progNum = (UInt16(bytes[p]) << 8) | UInt16(bytes[p + 1])
                        let pPid = (UInt16(bytes[p + 2] & 0x1F) << 8) | UInt16(bytes[p + 3])
                        if progNum != 0 && pmtPid == nil { pmtPid = pPid }
                        p += 4
                    }
                }
            } else if pid == pmtPid {
                if pusi { pos += 1 + Int(bytes[pos]) }
                if pos + 12 <= end {
                    let sectionLen = (Int(bytes[pos + 1] & 0x0F) << 8) | Int(bytes[pos + 2])
                    let secEnd = min(end, pos + 3 + sectionLen - 4)
                    let progInfoLen = (Int(bytes[pos + 10] & 0x0F) << 8) | Int(bytes[pos + 11])
                    var p = pos + 12 + progInfoLen
                    while p + 5 <= secEnd {
                        let streamType = bytes[p]
                        let ePid = (UInt16(bytes[p + 1] & 0x1F) << 8) | UInt16(bytes[p + 2])
                        let esInfoLen = (Int(bytes[p + 3] & 0x0F) << 8) | Int(bytes[p + 4])
                        if streamType == 0x24 {
                            videoPid = ePid; isHevc = true
                        } else if streamType == 0x1B && videoPid == nil {
                            videoPid = ePid; isHevc = false
                        } else if (streamType == 0x0F || streamType == 0x03 || streamType == 0x04) && audioPid == nil {
                            audioPid = ePid
                        }
                        p += 5 + esInfoLen
                    }
                }
            } else if pid == videoPid {
                if pusi {
                    flushVideoPes()
                    hasVideoPes = true
                }
                if hasVideoPes {
                    videoPes.append(contentsOf: bytes[pos..<end])
                }
            } else if pid == audioPid {
                if pusi {
                    flushAudioPes()
                    hasAudioPes = true
                }
                if hasAudioPes {
                    audioPes.append(contentsOf: bytes[pos..<end])
                }
            }
            offset += 188
        }

        flushVideoPes()
        flushAudioPes()

        if let sps = spsData, let pps = ppsData {
            result.videoConfig = VideoConfig(isHevc: isHevc, width: 1280, height: 720, vps: vpsData, sps: sps, pps: pps)
        }
        return result
    }

    private static let sampleRateTable = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, 0, 0, 0]

    private static func parsePesHeader(_ pes: Data) -> (UInt64, UInt64, Int) {
        let b = [UInt8](pes)
        guard b.count >= 9, b[0] == 0, b[1] == 0, b[2] == 1 else { return (0, 0, 0) }
        let flags = b[7]
        let hdrLen = Int(b[8])
        let payloadStart = 9 + hdrLen
        var pts: UInt64 = 0
        var dts: UInt64 = 0
        if (flags & 0x80) != 0 && b.count >= 14 {
            pts = parseTsTimestamp(b, offset: 9)
            dts = pts
        }
        if (flags & 0x40) != 0 && b.count >= 19 {
            dts = parseTsTimestamp(b, offset: 14)
        }
        return (pts, dts, payloadStart)
    }

    private static func parseTsTimestamp(_ b: [UInt8], offset o: Int) -> UInt64 {
        let p1 = UInt64((b[o] >> 1) & 0x07) << 30
        let p2 = UInt64(b[o + 1]) << 22
        let p3 = UInt64((b[o + 2] >> 1) & 0x7F) << 15
        let p4 = UInt64(b[o + 3]) << 7
        let p5 = UInt64((b[o + 4] >> 1) & 0x7F)
        return p1 | p2 | p3 | p4 | p5
    }

    private static func splitAnnexBNalus(_ data: Data) -> [Data] {
        let b = [UInt8](data)
        let n = b.count
        var nalus: [Data] = []
        var i = 0
        var start = -1
        while i < n {
            if i + 3 <= n && b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 {
                if start >= 0 {
                    var end = i
                    if end > start && b[end - 1] == 0 { end -= 1 }
                    if end > start { nalus.append(Data(b[start..<end])) }
                }
                start = i + 3
                i += 3
                continue
            }
            i += 1
        }
        if start >= 0 && start < n {
            nalus.append(Data(b[start..<n]))
        }
        return nalus
    }

    // MARK: - ISO BMFF Box Builders

    private static func box(_ type: String, _ payload: Data) -> Data {
        var d = Data()
        var size = UInt32(8 + payload.count).bigEndian
        d.append(Data(bytes: &size, count: 4))
        d.append(contentsOf: type.utf8.prefix(4))
        d.append(payload)
        return d
    }

    private static func fullBox(_ type: String, version: UInt8 = 0, flags: UInt32 = 0, _ payload: Data) -> Data {
        var p = Data([version, UInt8((flags >> 16) & 0xFF), UInt8((flags >> 8) & 0xFF), UInt8(flags & 0xFF)])
        p.append(payload)
        return box(type, p)
    }

    private static func appendU16(_ d: inout Data, _ v: UInt16) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 2)) }
    private static func appendU32(_ d: inout Data, _ v: UInt32) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 4)) }
    private static func appendU64(_ d: inout Data, _ v: UInt64) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 8)) }

    static func buildInitSegment(video: VideoConfig?, audio: AudioConfig?) -> Data {
        var ftypP = Data("isom".utf8)
        appendU32(&ftypP, 0x200)
        ftypP.append(contentsOf: "isomiso6mp41".utf8)
        let ftyp = box("ftyp", ftypP)

        var mvhdP = Data()
        appendU32(&mvhdP, 0); appendU32(&mvhdP, 0)
        appendU32(&mvhdP, 90000); appendU32(&mvhdP, 0)
        appendU32(&mvhdP, 0x00010000)
        appendU16(&mvhdP, 0x0100); appendU16(&mvhdP, 0)
        mvhdP.append(Data(count: 8))
        // matrix
        let matrix: [UInt32] = [0x00010000,0,0, 0,0x00010000,0, 0,0,0x40000000]
        for m in matrix { appendU32(&mvhdP, m) }
        mvhdP.append(Data(count: 24))
        appendU32(&mvhdP, 3)
        let mvhd = fullBox("mvhd", mvhdP)

        var moovP = mvhd
        var mvexP = Data()

        if let v = video {
            moovP.append(buildVideoTrak(v))
            var trexP = Data()
            appendU32(&trexP, 1); appendU32(&trexP, 1); appendU32(&trexP, 0); appendU32(&trexP, 0); appendU32(&trexP, 0)
            mvexP.append(fullBox("trex", trexP))
        }
        if let a = audio {
            moovP.append(buildAudioTrak(a))
            var trexP = Data()
            appendU32(&trexP, 2); appendU32(&trexP, 1); appendU32(&trexP, 0); appendU32(&trexP, 0); appendU32(&trexP, 0)
            mvexP.append(fullBox("trex", trexP))
        }
        moovP.append(box("mvex", mvexP))
        var out = ftyp
        out.append(box("moov", moovP))
        return out
    }

    private static func buildVideoTrak(_ v: VideoConfig) -> Data {
        var tkhdP = Data()
        appendU32(&tkhdP, 0); appendU32(&tkhdP, 0)
        appendU32(&tkhdP, 1); appendU32(&tkhdP, 0); appendU32(&tkhdP, 0)
        tkhdP.append(Data(count: 8))
        appendU16(&tkhdP, 0); appendU16(&tkhdP, 0); appendU16(&tkhdP, 0); appendU16(&tkhdP, 0)
        let matrix: [UInt32] = [0x00010000,0,0, 0,0x00010000,0, 0,0,0x40000000]
        for m in matrix { appendU32(&tkhdP, m) }
        appendU32(&tkhdP, UInt32(v.width) << 16)
        appendU32(&tkhdP, UInt32(v.height) << 16)
        let tkhd = fullBox("tkhd", version: 0, flags: 7, tkhdP)

        var mdhdP = Data()
        appendU32(&mdhdP, 0); appendU32(&mdhdP, 0); appendU32(&mdhdP, 90000); appendU32(&mdhdP, 0)
        appendU16(&mdhdP, 0x55C4); appendU16(&mdhdP, 0)
        let mdhd = fullBox("mdhd", mdhdP)

        var hdlrP = Data()
        appendU32(&hdlrP, 0)
        hdlrP.append(contentsOf: "vide".utf8)
        hdlrP.append(Data(count: 12))
        hdlrP.append(contentsOf: "VideoHandler\0".utf8)
        let hdlr = fullBox("hdlr", hdlrP)

        let vmhd = fullBox("vmhd", version: 0, flags: 1, Data(count: 8))
        let urlBox = fullBox("url ", version: 0, flags: 1, Data())
        var drefP = Data(); appendU32(&drefP, 1); drefP.append(urlBox)
        let dinf = box("dinf", fullBox("dref", drefP))

        let sampleEntry: Data
        if v.isHevc {
            var hvcc = Data()
            hvcc.append(1) // configurationVersion
            let spsBytes = [UInt8](v.sps)
            let ptlByte: UInt8 = spsBytes.count > 3 ? spsBytes[3] : 0x01
            hvcc.append(ptlByte)
            hvcc.append(contentsOf: [0x60, 0x00, 0x00, 0x00]) // general_profile_compatibility_flags
            hvcc.append(contentsOf: [0x90, 0x00, 0x00, 0x00, 0x00, 0x00]) // constraint_indicator_flags
            hvcc.append(93) // level_idc (3.1)
            appendU16(&hvcc, 0xF000) // min_spatial_segmentation_idc
            hvcc.append(0xFC) // parallelismType
            hvcc.append(0xFD) // chromaFormat = 1 (4:2:0)
            hvcc.append(0xF8) // bitDepthLumaMinus8 = 0
            hvcc.append(0xF8) // bitDepthChromaMinus8 = 0
            appendU16(&hvcc, 0) // avgFrameRate
            hvcc.append(0x0F) // constantFrameRate=0, numTemporalLayers=1, temporalIdNested=1, lengthSizeMinusOne=3
            var arrays: [(UInt8, Data)] = []
            if let vps = v.vps { arrays.append((32, vps)) }
            arrays.append((33, v.sps))
            arrays.append((34, v.pps))
            hvcc.append(UInt8(arrays.count))
            for (nalType, nal) in arrays {
                hvcc.append(0x80 | nalType)
                appendU16(&hvcc, 1)
                appendU16(&hvcc, UInt16(nal.count))
                hvcc.append(nal)
            }
            var hvc1P = Data(count: 6)
            appendU16(&hvc1P, 1)
            hvc1P.append(Data(count: 16))
            appendU16(&hvc1P, UInt16(v.width)); appendU16(&hvc1P, UInt16(v.height))
            appendU32(&hvc1P, 0x00480000); appendU32(&hvc1P, 0x00480000)
            appendU32(&hvc1P, 0); appendU16(&hvc1P, 1)
            hvc1P.append(Data(count: 32))
            appendU16(&hvc1P, 0x0018); appendU16(&hvc1P, 0xFFFF)
            hvc1P.append(box("hvcC", hvcc))
            sampleEntry = box("hvc1", hvc1P)
        } else {
            let spsBytes = [UInt8](v.sps)
            var avcc = Data([1, spsBytes.count > 1 ? spsBytes[1] : 0x42, spsBytes.count > 2 ? spsBytes[2] : 0x00, spsBytes.count > 3 ? spsBytes[3] : 0x1E, 0xFF, 0xE1])
            appendU16(&avcc, UInt16(v.sps.count)); avcc.append(v.sps)
            avcc.append(1)
            appendU16(&avcc, UInt16(v.pps.count)); avcc.append(v.pps)
            var avc1P = Data(count: 6)
            appendU16(&avc1P, 1)
            avc1P.append(Data(count: 16))
            appendU16(&avc1P, UInt16(v.width)); appendU16(&avc1P, UInt16(v.height))
            appendU32(&avc1P, 0x00480000); appendU32(&avc1P, 0x00480000)
            appendU32(&avc1P, 0); appendU16(&avc1P, 1)
            avc1P.append(Data(count: 32))
            appendU16(&avc1P, 0x0018); appendU16(&avc1P, 0xFFFF)
            avc1P.append(box("avcC", avcc))
            sampleEntry = box("avc1", avc1P)
        }

        var stsdP = Data(); appendU32(&stsdP, 1); stsdP.append(sampleEntry)
        let stsd = fullBox("stsd", stsdP)
        let empty = Data(count: 4)
        let stbl = box("stbl", stsd + fullBox("stts", empty) + fullBox("stsc", empty) + fullBox("stsz", Data(count: 8)) + fullBox("stco", empty))
        let minf = box("minf", vmhd + dinf + stbl)
        let mdia = box("mdia", mdhd + hdlr + minf)
        return box("trak", tkhd + mdia)
    }

    private static func buildAudioTrak(_ a: AudioConfig) -> Data {
        var tkhdP = Data()
        appendU32(&tkhdP, 0); appendU32(&tkhdP, 0)
        appendU32(&tkhdP, 2); appendU32(&tkhdP, 0); appendU32(&tkhdP, 0)
        tkhdP.append(Data(count: 8))
        appendU16(&tkhdP, 0); appendU16(&tkhdP, 0); appendU16(&tkhdP, 0x0100); appendU16(&tkhdP, 0)
        let matrix: [UInt32] = [0x00010000,0,0, 0,0x00010000,0, 0,0,0x40000000]
        for m in matrix { appendU32(&tkhdP, m) }
        appendU32(&tkhdP, 0); appendU32(&tkhdP, 0)
        let tkhd = fullBox("tkhd", version: 0, flags: 7, tkhdP)

        var mdhdP = Data()
        appendU32(&mdhdP, 0); appendU32(&mdhdP, 0); appendU32(&mdhdP, UInt32(a.sampleRate)); appendU32(&mdhdP, 0)
        appendU16(&mdhdP, 0x55C4); appendU16(&mdhdP, 0)
        let mdhd = fullBox("mdhd", mdhdP)

        var hdlrP = Data()
        appendU32(&hdlrP, 0); hdlrP.append(contentsOf: "soun".utf8)
        hdlrP.append(Data(count: 12)); hdlrP.append(contentsOf: "SoundHandler\0".utf8)
        let hdlr = fullBox("hdlr", hdlrP)

        let smhd = fullBox("smhd", Data(count: 4))
        let urlBox = fullBox("url ", version: 0, flags: 1, Data())
        var drefP = Data(); appendU32(&drefP, 1); drefP.append(urlBox)
        let dinf = box("dinf", fullBox("dref", drefP))

        let asc0 = UInt8((a.audioObjectType << 3) | ((a.freqIndex >> 1) & 0x07))
        let asc1 = UInt8(((a.freqIndex & 0x01) << 7) | ((a.channels & 0x0F) << 3))
        let esdsP = Data([
            0x03, 0x19, 0x00, 0x02, 0x00,
            0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x05, 0x02, asc0, asc1,
            0x06, 0x01, 0x02
        ])
        var mp4aP = Data(count: 6)
        appendU16(&mp4aP, 1); mp4aP.append(Data(count: 8))
        appendU16(&mp4aP, UInt16(a.channels)); appendU16(&mp4aP, 16)
        appendU16(&mp4aP, 0); appendU16(&mp4aP, 0)
        appendU32(&mp4aP, UInt32(a.sampleRate) << 16)
        mp4aP.append(fullBox("esds", esdsP))

        var stsdP = Data(); appendU32(&stsdP, 1); stsdP.append(box("mp4a", mp4aP))
        let stsd = fullBox("stsd", stsdP)
        let empty = Data(count: 4)
        let stbl = box("stbl", stsd + fullBox("stts", empty) + fullBox("stsc", empty) + fullBox("stsz", Data(count: 8)) + fullBox("stco", empty))
        let minf = box("minf", smhd + dinf + stbl)
        let mdia = box("mdia", mdhd + hdlr + minf)
        return box("trak", tkhd + mdia)
    }

    static func buildMediaSegment(seq: UInt32, parsed: ParsedChunk, audioSampleRate: Int) -> Data {
        var mfhdP = Data(); appendU32(&mfhdP, seq)
        var moofP = fullBox("mfhd", mfhdP)

        var vData = Data()
        var aData = Data()
        let hasV = !parsed.videoSamples.isEmpty
        let hasA = !parsed.audioSamples.isEmpty

        // Placeholder offsets patched after moof size is known
        var vOffsetPos = -1
        var aOffsetPos = -1

        if hasV {
            var tfhdP = Data(); appendU32(&tfhdP, 1)
            let tfhd = fullBox("tfhd", version: 0, flags: 0x020000, tfhdP)
            var tfdtP = Data(); appendU64(&tfdtP, parsed.videoSamples[0].dts)
            let tfdt = fullBox("tfdt", version: 1, flags: 0, tfdtP)

            var trunP = Data()
            appendU32(&trunP, UInt32(parsed.videoSamples.count))
            vOffsetPos = 8 + moofP.count + 8 + tfhd.count + tfdt.count + 16
            appendU32(&trunP, 0) // data_offset placeholder
            for (i, s) in parsed.videoSamples.enumerated() {
                let nextDts = i + 1 < parsed.videoSamples.count ? parsed.videoSamples[i + 1].dts : (s.dts + 3750)
                let dur = UInt32(max(1, Int64(nextDts) - Int64(s.dts)))
                let flags: UInt32 = s.isSync ? 0x02000000 : 0x01010000
                let cto = Int32(Int64(s.pts) - Int64(s.dts))
                appendU32(&trunP, dur)
                appendU32(&trunP, UInt32(s.data.count))
                appendU32(&trunP, flags)
                appendU32(&trunP, UInt32(bitPattern: cto))
                vData.append(s.data)
            }
            let trun = fullBox("trun", version: 1, flags: 0x0F01, trunP)
            moofP.append(box("traf", tfhd + tfdt + trun))
        }

        if hasA {
            var tfhdP = Data(); appendU32(&tfhdP, 2)
            let tfhd = fullBox("tfhd", version: 0, flags: 0x020000, tfhdP)
            let baseA = UInt64(Double(parsed.audioSamples[0].dts) * Double(audioSampleRate) / 90000.0)
            var tfdtP = Data(); appendU64(&tfdtP, baseA)
            let tfdt = fullBox("tfdt", version: 1, flags: 0, tfdtP)

            var trunP = Data()
            appendU32(&trunP, UInt32(parsed.audioSamples.count))
            aOffsetPos = 8 + moofP.count + 8 + tfhd.count + tfdt.count + 16
            appendU32(&trunP, 0) // data_offset placeholder
            for s in parsed.audioSamples {
                appendU32(&trunP, 1024)
                appendU32(&trunP, UInt32(s.data.count))
                aData.append(s.data)
            }
            let trun = fullBox("trun", version: 0, flags: 0x0301, trunP)
            moofP.append(box("traf", tfhd + tfdt + trun))
        }

        var moof = box("moof", moofP)
        let mdatHeaderSize = 8
        let vDataOffset = UInt32(moof.count + mdatHeaderSize)
        let aDataOffset = UInt32(moof.count + mdatHeaderSize + vData.count)

        if vOffsetPos >= 0 {
            let offBE = vDataOffset.bigEndian
            withUnsafeBytes(of: offBE) { moof.replaceSubrange(vOffsetPos..<(vOffsetPos + 4), with: $0) }
        }
        if aOffsetPos >= 0 {
            let offBE = aDataOffset.bigEndian
            withUnsafeBytes(of: offBE) { moof.replaceSubrange(aOffsetPos..<(aOffsetPos + 4), with: $0) }
        }

        var mdatPayload = vData
        mdatPayload.append(aData)
        var out = moof
        out.append(box("mdat", mdatPayload))
        return out
    }
}
