/**
 * REAL-TIME LOCATION TRACKER - UTILITY FUNCTIONS
 * 
 * This file contains utility functions for:
 * 1. Distance calculations
 * 2. Coordinate formatting
 * 3. Map marker customization
 * 4. Time formatting
 * 5. Speed calculations
 */

//============================================================
// COORDINATE HANDLING
//============================================================

/**
 * Format a coordinate value to a fixed precision for display
 * 
 * @param {number} coord - The coordinate value (latitude or longitude)
 * @returns {string} Formatted coordinate with 6 decimal places
 */
function formatCoordinate(coord) {
    return coord.toFixed(6);
}

//============================================================
// DISTANCE CALCULATIONS
//============================================================

/**
 * Calculate the distance between two geographic points using the Haversine formula
 * 
 * @param {number} lat1 - Latitude of first point in decimal degrees
 * @param {number} lon1 - Longitude of first point in decimal degrees
 * @param {number} lat2 - Latitude of second point in decimal degrees
 * @param {number} lon2 - Longitude of second point in decimal degrees
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    // Earth's radius in meters
    const R = 6371e3; 
    
    // Convert latitude and longitude from degrees to radians
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    
    // Haversine formula
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    // Distance in meters
    return R * c;
}

//============================================================
// MAP VISUALIZATION
//============================================================

/**
 * Create a custom map marker icon with a specified color
 * 
 * @param {string} color - CSS color value for the marker (e.g., '#FF5722')
 * @param {string} text - Optional text to display inside the marker
 * @returns {L.DivIcon} Leaflet divIcon object for the marker
 */
function createMapIcon(color, text) {
    return L.divIcon({
        className: 'custom-map-icon',
        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 3px rgba(0,0,0,0.4);">${text || ''}</div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

//============================================================
// TIME FORMATTING
//============================================================

/**
 * Format a timestamp into a readable time string
 * 
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted time string (e.g., "2:45:30 PM")
 */
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

//============================================================
// SPEED CALCULATIONS
//============================================================

/**
 * Calculate average speed based on a series of positions and timestamps
 * 
 * @param {Array<Array<number>>} positions - Array of [lat, lon] position pairs
 * @param {Array<number>} timestamps - Array of timestamps corresponding to positions
 * @returns {number} Average speed in km/h
 */
function calculateAverageSpeed(positions, timestamps) {
    // Need at least two positions to calculate speed
    if (positions.length < 2 || timestamps.length < 2) {
        return 0;
    }
    
    // Calculate total distance traveled
    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
        const [lat1, lon1] = positions[i-1];
        const [lat2, lon2] = positions[i];
        totalDistance += calculateDistance(lat1, lon1, lat2, lon2);
    }
    
    // Calculate time elapsed in seconds
    const timeElapsed = (timestamps[timestamps.length-1] - timestamps[0]) / 1000;
    
    // Avoid division by zero
    if (timeElapsed === 0) {
        return 0;
    }
    
    // Convert speed from m/s to km/h
    return (totalDistance / timeElapsed) * 3.6;
} 