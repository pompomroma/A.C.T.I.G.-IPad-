import SwiftUI
import PhotosUI

/// The blue hologram chat box: scrolling transcript plus the input row where the
/// user types commands, attaches files/images, or sees their live voice
/// transcription. This is the single command surface described in the request.
struct HologramChatBox: View {
    @EnvironmentObject private var state: AppState
    @EnvironmentObject private var assistant: AssistantController

    @State private var draft: String = ""
    @State private var pickedItem: PhotosPickerItem?
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 10) {
            transcript
            inputRow
        }
    }

    // MARK: - Transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(state.messages) { msg in
                        bubble(for: msg).id(msg.id)
                    }
                    if !state.liveTranscript.isEmpty {
                        bubble(for: ChatMessage(role: .user, text: state.liveTranscript))
                            .opacity(0.6)
                            .id("live")
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: state.messages.count) { _ in
                withAnimation { proxy.scrollTo(state.messages.last?.id, anchor: .bottom) }
            }
            .onChange(of: state.liveTranscript) { _ in
                withAnimation { proxy.scrollTo("live", anchor: .bottom) }
            }
        }
    }

    private func bubble(for msg: ChatMessage) -> some View {
        let isUser = msg.role == .user
        let isSystem = msg.role == .system
        return HStack {
            if isUser { Spacer(minLength: 30) }
            Text(msg.text.isEmpty && msg.isStreaming ? "…" : msg.text)
                .font(isSystem ? .caption : .callout)
                .foregroundStyle(
                    isSystem ? HoloTheme.primary.opacity(0.7)
                    : (isUser ? Color.white : HoloTheme.accent)
                )
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isUser ? HoloTheme.primary.opacity(0.22) : HoloTheme.deep.opacity(0.55))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(HoloTheme.primary.opacity(isUser ? 0.5 : 0.3), lineWidth: 1)
                        )
                )
            if !isUser { Spacer(minLength: 30) }
        }
    }

    // MARK: - Input

    private var inputRow: some View {
        HStack(spacing: 10) {
            PhotosPicker(selection: $pickedItem, matching: .any(of: [.images, .videos])) {
                Image(systemName: "paperclip")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(HoloTheme.primary)
            }
            .onChange(of: pickedItem) { _ in handleAttachment() }

            TextField("Command A.C.T.I.G.…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .tint(HoloTheme.accent)
                .lineLimit(1...4)
                .focused($inputFocused)
                .onSubmit(send)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(
                    Capsule().fill(HoloTheme.deep.opacity(0.5))
                        .overlay(Capsule().stroke(HoloTheme.primary.opacity(0.5), lineWidth: 1))
                )

            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(draft.isEmpty ? HoloTheme.primary.opacity(0.4) : HoloTheme.accent)
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Task { await assistant.handleUserText(text) }
    }

    private func handleAttachment() {
        guard let item = pickedItem else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self) {
                await assistant.handleAttachment(data: data)
            }
            pickedItem = nil
        }
    }
}
