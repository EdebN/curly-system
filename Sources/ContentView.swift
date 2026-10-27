import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            LiveIdentifierView()
                .tabItem { Label("Identify", systemImage: "viewfinder") }
            BirdLibraryView()
                .tabItem { Label("Bird library", systemImage: "books.vertical") }
        }
        .tint(.green)
    }
}
